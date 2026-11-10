import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  accountKeysFromPrivateKey,
  base64urlEncode,
  openKeyring,
} from '@/lib/e2ee'
import { createAccountUnwrapper } from '@/lib/e2ee/client/files'
import { newFolderKeys } from '@/lib/e2ee/client/folders'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import {
  type MigrationApi,
  migrateStanzas,
  resealLibrary,
} from '@/lib/e2ee/client/rotation'
import { sealedTagRecord } from '@/lib/e2ee/client/tags'
import type { AccountPrivateKey, AccountPublicKey } from '@/lib/e2ee/types'
import { ownedFolderViews } from '@/lib/folders/owned'
import { ownedTagViews } from '@/lib/tags/owned'

import { clientKeys } from '../auth/e2ee-test-keys'
import {
  type TestKeys,
  createUser,
  encryptedFile,
  encryptedUploadInput,
  insertEncryptedFile,
  libraryTestDatabaseUrl,
  sessionUser,
  storedKeys,
} from './support'

const databaseUrl = process.env.FLARE_LIBRARY_DATABASE_URL

vi.mock('@/lib/database/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return {
    prisma: new PrismaClient({
      datasourceUrl:
        process.env.FLARE_LIBRARY_DATABASE_URL ||
        'postgresql://unused@127.0.0.1/unused',
    }),
  }
})
vi.mock('@/lib/config', () => ({
  readConfig: async () => ({
    settings: {
      general: {
        ocr: { enabled: true },
        storage: {
          maxUploadSize: { value: 10, unit: 'MB' },
          quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
        },
      },
    },
  }),
}))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueFileReady: vi.fn() }))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: vi.fn() } }))

vi.setConfig({ testTimeout: 30_000 })

describe.skipIf(!databaseUrl)(
  'rotation, stanza migration and reset for the library (PostgreSQL)',
  () => {
    let prisma: typeof import('@/lib/database/prisma').prisma
    let auth: typeof import('@/lib/auth/e2ee/service')
    let library: typeof import('@/lib/auth/e2ee/library-records')
    let folders: typeof import('@/lib/folders/service')
    let tags: typeof import('@/lib/tags/manage')
    let migration: typeof import('@/lib/files/stanza-migration')
    let finalize: typeof import('@/lib/uploads/finalize')
    let keys: TestKeys
    let owner: string

    beforeAll(async () => {
      libraryTestDatabaseUrl(databaseUrl!)
      prisma = (await import('@/lib/database/prisma')).prisma
      auth = await import('@/lib/auth/e2ee/service')
      library = await import('@/lib/auth/e2ee/library-records')
      folders = await import('@/lib/folders/service')
      tags = await import('@/lib/tags/manage')
      migration = await import('@/lib/files/stanza-migration')
      finalize = await import('@/lib/uploads/finalize')
      const { ensureBuiltInRoles } = await import('@/lib/permissions/server')
      await prisma.$transaction((tx) => ensureBuiltInRoles(tx))
    })
    beforeEach(async () => {
      keys = clientKeys()
      owner = (await createUser(prisma, keys)).id
    })
    afterAll(async () => {
      await prisma?.$disconnect()
    })

    const pair = (source: TestKeys) => ({
      accountPrivateKey: source.accountKeys.accountPrivateKey,
      accountPublicKey: source.accountKeys.accountPublicKey,
    })
    async function library2() {
      const { folderInputSchema } = await import('@/lib/folders/schema')
      const { tagInputSchema } = await import('@/lib/tags/schema')
      const folder = await folders.createFolder(
        owner,
        folderInputSchema.parse(
          newFolderKeys(keys.accountKeys.accountPrivateKey, 'Contracts').records
        )
      )
      const tag = await tags.createTag(
        owner,
        tagInputSchema.parse({
          sealedTagMetadata: sealedTagRecord(pair(keys), {
            name: 'Signed',
            ruleSource: 'filename',
            ruleText: 'signed',
          }),
        })
      )
      return { folder, tag }
    }
    /** What a rotation sends, parsed as the route parses it. */
    async function rotate(next: TestKeys, sent: unknown) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: owner } })
      const { accountRecordSchema } = await import('@/lib/auth/e2ee/records')
      return auth.rotateAccountKeys(
        owner,
        user,
        accountRecordSchema.parse(next.record),
        null,
        library.rotatedLibrarySchema.parse(sent)
      )
    }
    const sealedLibrary = async () => {
      const sealed = await library.sealedLibraryRecords(prisma, owner)
      return {
        folders: sealed.folders,
        tags: sealed.tags.map((tag) => ({
          id: tag.id,
          sealed: tag.sealedTagMetadata,
        })),
      }
    }

    it('replaces every sealed folder key and tag record in the rotation, and refuses a request that leaves one out', async () => {
      const { folder, tag } = await library2()
      const next = clientKeys()
      const resealed = resealLibrary(
        pair(keys),
        pair(next),
        await sealedLibrary()
      )
      expect(resealed.folders.map((entry) => entry.id)).toEqual([folder.id])
      expect(resealed.tags.map((entry) => entry.id)).toEqual([tag.id])

      await expect(rotate(next, {})).rejects.toMatchObject({
        status: 409,
        body: { code: 'library_records_incomplete' },
      })
      await expect(
        rotate(next, { folders: resealed.folders, tags: [] })
      ).rejects.toMatchObject({ status: 409 })
      await expect(
        rotate(next, {
          folders: [
            ...resealed.folders,
            { ...resealed.folders[0], id: 'other' },
          ],
          tags: resealed.tags,
        })
      ).rejects.toMatchObject({ status: 409 })
      // Nothing changed: the old key still opens everything.
      const before = storedKeys(owner, keys)
      expect(
        ownedFolderViews(await folders.listFolders(owner), before)[0].name
      ).toBe('Contracts')

      await rotate(next, resealed)
      const after = storedKeys(owner, next)
      expect(
        ownedFolderViews(await folders.listFolders(owner), after)[0]
      ).toMatchObject({ name: 'Contracts', id: folder.id })
      expect(ownedTagViews(await tags.listTags(owner), after)[0]).toMatchObject(
        {
          name: 'Signed',
          ruleText: 'signed',
        }
      )
      // The old account key opens neither any more.
      expect(
        ownedFolderViews(await folders.listFolders(owner), before)[0].locked
      ).toBe(true)
      expect(ownedTagViews(await tags.listTags(owner), before)[0].locked).toBe(
        true
      )
      // The key pair of the folder did not change (section 8.3.4).
      expect((await folders.listFolders(owner))[0].keys!.folderPublicKey).toBe(
        folder.keys!.folderPublicKey
      )
    })

    it('migrates stanzas to the current key in the background and prunes the keyring', async () => {
      const first = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys, 'a.txt')
      )
      const second = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys, 'b.txt')
      )
      // A stanza that no key opens: its file key was made for another account.
      const foreign = clientKeys()
      const broken = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(foreign, 'x.txt')
      )
      const next = clientKeys()
      await rotate(next, { folders: [], tags: [] })
      // After the rotation, an upload for the old key is refused.
      await expect(
        finalize.finalizeUpload(
          encryptedUploadInput(sessionUser(owner), encryptedFile(keys))
        )
      ).rejects.toMatchObject({ status: 409 })
      const fresh = await finalize.finalizeUpload(
        encryptedUploadInput(sessionUser(owner), encryptedFile(next, 'new.txt'))
      )

      const browser: StoredAccountKeys = {
        ...storedKeys(owner, next),
        oldPrivateKeys: [keys.accountKeys.accountPrivateKey],
      }
      let keyring: Uint8Array | null | undefined
      const api: MigrationApi = {
        oldStanzas: (after) =>
          migration.oldAccountStanzas(owner, after ?? null),
        replace: (body) =>
          migration.replaceAccountStanzas(
            owner,
            migration.accountStanzasSchema.parse(body)
          ),
        replaceKeyring: async (sealed) => {
          keyring = sealed
        },
      }
      expect(await migration.oldAccountStanzas(owner)).toMatchObject({
        remaining: 3,
        oldKeys: expect.arrayContaining([
          base64urlEncode(keys.accountKeys.accountPublicKey),
        ]),
      })
      const unwrapper = await createAccountUnwrapper(browser, {
        useNative: false,
      })
      const progress: number[] = []
      const result = await migrateStanzas(api, browser, unwrapper, {
        onProgress: (done) => progress.push(done),
      })
      expect(result).toMatchObject({ migrated: 2, pruned: true })
      expect(progress).toEqual([2])
      // The old key has no stanza left: the new keyring is empty.
      expect(result.oldPrivateKeys).toEqual([])
      expect(keyring).toBeNull()
      // The current key alone opens the migrated files, and the file keys
      // did not change: an old share link still opens.
      const current = await createAccountUnwrapper(storedKeys(owner, next), {
        useNative: false,
      })
      for (const [file, name] of [
        [first, 'a.txt'],
        [second, 'b.txt'],
        [fresh, 'new.txt'],
      ] as const) {
        const row = await prisma.file.findUniqueOrThrow({
          where: { id: file.id },
        })
        expect(Buffer.from(row.stanzaAccountPublicKey!)).toEqual(
          Buffer.from(next.accountKeys.accountPublicKey)
        )
        const opened = await current.unwrap({
          header: base64urlEncode(row.header!),
          sealedMetadata: base64urlEncode(row.sealedMetadata!),
          accountStanza: base64urlEncode(row.accountStanza!),
        })
        expect(opened.name).toBe(name)
      }
      // The stanza that no key opens stays, and its key stays in a keyring.
      expect(await migration.oldAccountStanzas(owner)).toMatchObject({
        remaining: 1,
        stanzas: [{ id: broken.id }],
      })
      const kept = await migrateStanzas(
        api,
        {
          ...browser,
          oldPrivateKeys: [
            foreign.accountKeys.accountPrivateKey,
            keys.accountKeys.accountPrivateKey,
          ],
        },
        unwrapper
      )
      expect(kept.oldPrivateKeys).toEqual([
        foreign.accountKeys.accountPrivateKey,
      ])
      expect(
        openKeyring({
          accountPrivateKey: next.accountKeys
            .accountPrivateKey as AccountPrivateKey,
          accountPublicKey: next.accountKeys
            .accountPublicKey as AccountPublicKey,
          sealedKeyring: keyring!,
        }).map((key) =>
          base64urlEncode(accountKeysFromPrivateKey(key).accountPublicKey)
        )
      ).toEqual([base64urlEncode(foreign.accountKeys.accountPublicKey)])
      // A batch for a key that is not the current one is refused.
      await expect(
        migration.replaceAccountStanzas(
          owner,
          migration.accountStanzasSchema.parse({
            stanzaAccountPublicKey: base64urlEncode(
              keys.accountKeys.accountPublicKey
            ),
            stanzas: [
              {
                id: first.id,
                accountStanza: base64urlEncode(
                  (
                    await prisma.file.findUniqueOrThrow({
                      where: { id: first.id },
                    })
                  ).accountStanza!
                ),
              },
            ],
          })
        )
      ).rejects.toMatchObject({
        status: 409,
        body: { code: 'stale_account_key' },
      })
    })

    it('marks encrypted files unreadable at a reset, and gives folders and tags back without their sealed names', async () => {
      const { folder, tag } = await library2()
      const sharing = await folders.updateFolder(owner, folder.id, {
        sharing: true,
      })
      expect(sharing.shareToken).toBeTruthy()
      const secret = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys),
        {
          folderId: folder.id,
          ocrPending: true,
          thumbnailPending: true,
          rulesPending: true,
        }
      )
      const plain = await prisma.file.create({
        data: {
          userId: owner,
          name: 'plain.txt',
          urlPath: `/${owner}/plain.txt`,
          path: 'uploads/plain',
          mimeType: 'text/plain',
          size: 1,
          folderId: folder.id,
        },
      })
      await prisma.vaultFileTag.create({
        data: { fileId: plain.id, tagId: tag.id },
      })
      await prisma.$transaction((tx) => library.resetLibraryRecords(tx, owner))

      expect(
        await prisma.file.findUniqueOrThrow({ where: { id: secret.id } })
      ).toMatchObject({
        unreadable: true,
        ocrPending: false,
        thumbnailPending: false,
        rulesPending: false,
        folderStanza: null,
        folderId: folder.id,
      })
      expect(
        await prisma.file.findUniqueOrThrow({ where: { id: plain.id } })
      ).toMatchObject({ unreadable: false, name: 'plain.txt' })
      const [view] = await folders.listFolders(owner)
      expect(view).toMatchObject({
        id: folder.id,
        keys: null,
        shareToken: null,
        fileCount: 2,
      })
      expect(view.name).toMatch(/^Folder /)
      const [tagView] = await tags.listTags(owner)
      expect(tagView).toMatchObject({ id: tag.id, sealed: null, fileCount: 1 })
      expect(tagView.name).toMatch(/^Tag /)
      // Unreadable files are out of the migration, the sync and the repairs.
      expect((await migration.oldAccountStanzas(owner)).remaining).toBe(0)
      const { syncEncryptedFiles } = await import('@/lib/files/sync')
      expect((await syncEncryptedFiles(owner, 0)).state.count).toBe(0)
      // The folder is one from before encryption again: the next unlock
      // gives it keys.
      expect((await folders.folderRepairs(owner)).folderKeys).toEqual([
        folder.id,
      ])
    })
  }
)
