import { randomUUID } from 'node:crypto'
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
  folderSecretOf,
  folderStanzaFor,
  newFolderKeys,
  openChildFolder,
  openFolderFile,
  openFolderWithKey,
  parentStanzaFor,
  sealedFolderName,
} from '@/lib/e2ee/client/folders'
import { ownedFolderKeys, ownedFolderViews } from '@/lib/folders/owned'
import { type RepairsApi, repairFolders } from '@/lib/folders/repairs'
import type { FolderView } from '@/lib/folders/schema'

import { clientKeys } from '../auth/e2ee-test-keys'
import {
  type TestKeys,
  createUser,
  encryptedFile,
  encryptedUploadInput,
  insertEncryptedFile,
  libraryTestDatabaseUrl,
  passwordStanzaFor,
  sessionUser,
  storedKeys,
  unwrapperOf,
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

// Real queries; a full parallel run can take one past the 5 s default.
vi.setConfig({ testTimeout: 30_000 })

describe.skipIf(!databaseUrl)('folder keys and stanzas (PostgreSQL)', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/folders/service')
  let shared: typeof import('@/lib/folders/shared')
  let finalize: typeof import('@/lib/uploads/finalize')
  let keys: TestKeys
  let owner: string

  beforeAll(async () => {
    libraryTestDatabaseUrl(databaseUrl!)
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/folders/service')
    shared = await import('@/lib/folders/shared')
    finalize = await import('@/lib/uploads/finalize')
    const { ensureBuiltInRoles } = await import('@/lib/permissions/server')
    await prisma.$transaction((tx) => ensureBuiltInRoles(tx))
  })
  beforeEach(async () => {
    keys = clientKeys()
    owner = (await createUser(prisma, keys)).id
  })
  afterAll(async () => {
    await prisma?.user.deleteMany()
    await prisma?.$disconnect()
  })

  const stored = () => storedKeys(owner, keys)

  /** Creates a folder as the owner's browser does. */
  async function newFolder(name: string, parent?: FolderView) {
    const made = newFolderKeys(keys.accountKeys.accountPrivateKey, name)
    const parentKeys = parent ? ownedFolderKeys(parent, stored()) : null
    const { folderInputSchema } = await import('@/lib/folders/schema')
    const view = await service.createFolder(
      owner,
      folderInputSchema.parse({
        parentId: parent?.id ?? null,
        ...made.records,
        ...(parentKeys && parentStanzaFor(made.opened, parentKeys)),
      })
    )
    return { view, opened: made.opened }
  }

  /** The requests of the repairs procedure, answered by the services. */
  function repairsApi(): RepairsApi {
    return {
      folders: () => service.listFolders(owner),
      repairs: (after) => service.folderRepairs(owner, after ?? null),
      putKeys: async (body) => {
        const { folderKeysInputSchema } = await import('@/lib/folders/schema')
        return service.storeFolderKeys(owner, folderKeysInputSchema.parse(body))
      },
      putFileStanzas: async (body) => {
        const { fileFolderStanzasInputSchema } =
          await import('@/lib/folders/schema')
        return service.storeFileFolderStanzas(
          owner,
          fileFolderStanzasInputSchema.parse(body)
        )
      },
    }
  }
  const repair = async () =>
    repairFolders(repairsApi(), stored(), await unwrapperOf(stored()))

  it('stores a folder with keys and no name, and refuses a plain name for an account that has keys', async () => {
    const { view } = await newFolder('Tax 2026')
    const row = await prisma.vaultFolder.findUniqueOrThrow({
      where: { id: view.id },
    })
    expect(row.name).toBe('')
    expect(row.normalizedName).toBe(`/sealed/${view.id}`)
    expect(JSON.stringify(view)).not.toContain('Tax 2026')
    // The owner's browser opens the name with the account key.
    expect(ownedFolderViews([view], stored())[0].name).toBe('Tax 2026')
    expect(ownedFolderViews([view], null)[0]).toMatchObject({ locked: true })

    await expect(
      service.createFolder(owner, { name: 'Plain', parentId: null })
    ).rejects.toMatchObject({ status: 409 })
    // An account without keys keeps plain folders and cannot store sealed ones.
    const legacy = (await createUser(prisma, null)).id
    await expect(
      service.createFolder(legacy, { name: 'Plain', parentId: null })
    ).resolves.toMatchObject({ name: 'Plain', keys: null })
    const { folderInputSchema } = await import('@/lib/folders/schema')
    await expect(
      service.createFolder(
        legacy,
        folderInputSchema.parse({
          ...newFolderKeys(keys.accountKeys.accountPrivateKey, 'x').records,
        })
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('refuses a parent stanza for a key that the parent does not have', async () => {
    const parent = await newFolder('Parent')
    const stale = newFolderKeys(keys.accountKeys.accountPrivateKey, 'Other')
    const child = newFolderKeys(keys.accountKeys.accountPrivateKey, 'Child')
    const { folderInputSchema } = await import('@/lib/folders/schema')
    await expect(
      service.createFolder(
        owner,
        folderInputSchema.parse({
          parentId: parent.view.id,
          ...child.records,
          ...parentStanzaFor(child.opened, stale.opened),
        })
      )
    ).rejects.toMatchObject({ status: 409, body: { code: 'stale_folder_key' } })
    // A stanza without a parent is refused too.
    await expect(
      service.createFolder(
        owner,
        folderInputSchema.parse({
          ...child.records,
          ...parentStanzaFor(child.opened, parent.opened),
        })
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('renames with a new sealed name only', async () => {
    const { view, opened } = await newFolder('Old name')
    await expect(
      service.updateFolder(owner, view.id, { name: 'Plain name' })
    ).rejects.toMatchObject({ status: 400 })
    const { folderUpdateSchema } = await import('@/lib/folders/schema')
    const renamed = await service.updateFolder(
      owner,
      view.id,
      folderUpdateSchema.parse({
        sealedFolderMetadata: sealedFolderName(opened, 'New name'),
      })
    )
    expect(ownedFolderViews([renamed], stored())[0].name).toBe('New name')
  })

  it('accepts a folder stanza only for a public file in a folder with that key', async () => {
    const { view, opened } = await newFolder('Shared')
    const other = await newFolder('Other')
    const user = sessionUser(owner)
    const upload = (
      created: ReturnType<typeof encryptedFile>,
      folder: { folderPublicKey: Uint8Array } | null,
      options: Record<string, unknown>,
      extra: Record<string, string> = {}
    ) =>
      finalize.finalizeUpload(
        encryptedUploadInput(
          user,
          created,
          {
            ...(folder &&
              folderStanzaFor(
                folder as never,
                created,
                folderSecretOf(created, extra.passwordStanza)
              )),
            ...extra,
          },
          options
        )
      )
    // Public, in the folder, for its key: stored.
    const file = await upload(encryptedFile(keys), opened, {
      folderId: view.id,
      visibility: 'PUBLIC',
    })
    expect(file.folderStanza).toHaveLength(97)
    // Section 8.4.3: a private file must not have a folder stanza.
    await expect(
      upload(encryptedFile(keys), opened, {
        folderId: view.id,
        visibility: 'PRIVATE',
      })
    ).rejects.toMatchObject({ status: 400 })
    // Not in a folder, and a stanza for the key of a different folder.
    await expect(
      upload(encryptedFile(keys), opened, { visibility: 'PUBLIC' })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      upload(encryptedFile(keys), other.opened, {
        folderId: view.id,
        visibility: 'PUBLIC',
      })
    ).rejects.toMatchObject({ status: 409, body: { code: 'stale_folder_key' } })
    // A public upload without a stanza is accepted: a browser makes it later.
    const bare = await upload(encryptedFile(keys), null, {
      folderId: view.id,
      visibility: 'PUBLIC',
    })
    expect(bare.folderStanza).toBeNull()
    expect((await service.folderRepairs(owner)).fileStanzas).toEqual([
      expect.objectContaining({ id: bare.id, folderId: view.id }),
    ])
  })

  it('deletes the folder stanza when a file becomes private, moves or changes its password', async () => {
    const { view, opened } = await newFolder('A')
    const other = await newFolder('B')
    const created = encryptedFile(keys)
    const make = () =>
      insertEncryptedFile(prisma, owner, created, {
        folderId: view.id,
        visibility: 'PUBLIC',
        folderStanza: Buffer.from(
          folderStanzaFor(opened, created, folderSecretOf(created, null))
            .folderStanza,
          'base64url'
        ),
        folderStanzaPublicKey: Buffer.from(opened.folderPublicKey),
      })
    const stanzaOf = async (id: string) =>
      (await prisma.file.findUniqueOrThrow({ where: { id } })).folderStanza

    let file = await make()
    await prisma.file.update({
      where: { id: file.id },
      data: { visibility: 'PRIVATE' },
    })
    expect(await stanzaOf(file.id)).toBeNull()

    file = await make()
    await service.moveFilesToFolder(owner, {
      fileIds: [file.id],
      folderId: other.view.id,
    })
    expect(await stanzaOf(file.id)).toBeNull()

    file = await make()
    const { passwordStanza } = await passwordStanzaFor(keys, created)
    await prisma.file.update({
      where: { id: file.id },
      data: { passwordStanza: Buffer.from(passwordStanza, 'base64url') },
    })
    expect(await stanzaOf(file.id)).toBeNull()

    // The folder is deleted: the file moves up and its stanza goes.
    file = await make()
    await service.deleteFolder(owner, view.id)
    expect(await stanzaOf(file.id)).toBeNull()
    // A private file takes no stanza by the store route either.
    const hidden = await insertEncryptedFile(
      prisma,
      owner,
      encryptedFile(keys),
      {
        folderId: other.view.id,
        visibility: 'PRIVATE',
      }
    )
    await expect(
      service.storeFileFolderStanzas(owner, {
        stanzas: [
          {
            fileId: hidden.id,
            folderStanza: Uint8Array.from(Buffer.alloc(97, 1)),
            folderPublicKey: Uint8Array.from(other.opened.folderPublicKey),
          },
        ],
      })
    ).resolves.toEqual({ stored: 0, skipped: [hidden.id] })
  })

  it('lists a shared tree to a visitor who opens it with the folder key only', async () => {
    const root = await newFolder('Trip')
    const child = await newFolder('Day one', root.view)
    const plain = await prisma.file.create({
      data: {
        userId: owner,
        name: 'Plain map.png',
        urlPath: `/${owner}/plain-map.png`,
        path: `uploads/${randomUUID()}`,
        mimeType: 'image/png',
        size: 1,
        folderId: child.view.id,
      },
    })
    const secret = encryptedFile(keys, 'Passport scan.png')
    const locked = encryptedFile(keys, 'Locked notes.txt', 'text/plain')
    const { passwordStanza } = await passwordStanzaFor(keys, locked)
    const hidden = encryptedFile(keys, 'Private diary.txt', 'text/plain')
    const files = {
      secret: await insertEncryptedFile(prisma, owner, secret, {
        folderId: child.view.id,
      }),
      locked: await insertEncryptedFile(prisma, owner, locked, {
        folderId: child.view.id,
        passwordStanza: Buffer.from(passwordStanza, 'base64url'),
      }),
      hidden: await insertEncryptedFile(prisma, owner, hidden, {
        folderId: child.view.id,
        visibility: 'PRIVATE',
      }),
    }
    // The owner's browser makes what is missing: two folder stanzas.
    expect(await repair()).toEqual({
      folderKeys: 0,
      parentStanzas: 0,
      fileStanzas: 2,
    })
    expect((await service.folderRepairs(owner)).fileStanzas).toEqual([])

    const { shareToken } = await service.updateFolder(owner, root.view.id, {
      sharing: true,
    })
    const top = (await shared.getSharedFolder(shareToken!))!
    const listing = (await shared.getSharedFolder(
      shareToken!,
      1,
      child.view.id
    ))!
    const wire = JSON.stringify([top, listing])
    for (const text of ['Trip', 'Day one', 'Passport', 'Locked notes', 'diary'])
      expect(wire).not.toContain(text)
    expect(listing.files.map((file) => file.id).sort()).toEqual(
      [plain.id, files.secret.id, files.locked.id].sort()
    )

    // The visitor has the private key of the shared folder and nothing else.
    const visitorRoot = openFolderWithKey(
      top.root.keys!,
      root.opened.folderPrivateKey
    )
    expect(visitorRoot.name).toBe('Trip')
    const visitorChild = openChildFolder(visitorRoot, listing.trail[1].keys!)
    expect(visitorChild.name).toBe('Day one')
    const byId = new Map(listing.files.map((file) => [file.id, file]))
    const opened = openFolderFile(
      visitorChild,
      byId.get(files.secret.id) as never
    )
    expect(opened).toMatchObject({
      kind: 'file',
      opened: { name: 'Passport scan.png', type: 'image/png' },
    })
    expect(
      openFolderFile(visitorChild, byId.get(files.locked.id) as never)
    ).toMatchObject({
      kind: 'password',
      fragment: expect.stringMatching(/^p\./),
    })
    // A key of a different folder opens nothing.
    expect(() =>
      openFolderWithKey(top.root.keys!, child.opened.folderPrivateKey)
    ).toThrow()
  })

  it('gives new keys to the folder and each folder below it when sharing stops', async () => {
    const root = await newFolder('Root')
    const child = await newFolder('Child', root.view)
    const outside = await newFolder('Outside')
    const created = encryptedFile(keys)
    const file = await insertEncryptedFile(prisma, owner, created, {
      folderId: child.view.id,
    })
    await repair()
    const first = await service.updateFolder(owner, root.view.id, {
      sharing: true,
    })
    const stopped = await service.updateFolder(owner, root.view.id, {
      sharing: false,
    })
    expect(stopped.keys?.rekeyPending).toBe(true)
    expect(await shared.getSharedFolder(first.shareToken!)).toBeNull()
    expect((await service.folderRepairs(owner)).folderKeys.sort()).toEqual(
      [root.view.id, child.view.id].sort()
    )
    // Sharing again waits for the new keys.
    await expect(
      service.updateFolder(owner, root.view.id, { sharing: true })
    ).rejects.toMatchObject({ status: 409, body: { code: 'rekey_pending' } })

    expect(await repair()).toEqual({
      folderKeys: 2,
      parentStanzas: 1,
      fileStanzas: 1,
    })
    const views = await service.listFolders(owner)
    const view = (id: string) => views.find((entry) => entry.id === id)!
    expect(view(root.view.id).keys!.folderPublicKey).not.toBe(
      root.view.keys!.folderPublicKey
    )
    expect(view(child.view.id).keys!.folderPublicKey).not.toBe(
      child.view.keys!.folderPublicKey
    )
    expect(view(outside.view.id).keys!.folderPublicKey).toBe(
      outside.view.keys!.folderPublicKey
    )
    // The names survive, and the old link key opens nothing of the new link.
    expect(
      ownedFolderViews(views, stored())
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['Child', 'Outside', 'Root'])
    const again = await service.updateFolder(owner, root.view.id, {
      sharing: true,
    })
    expect(again.shareToken).not.toBe(first.shareToken)
    const listing = (await shared.getSharedFolder(
      again.shareToken!,
      1,
      child.view.id
    ))!
    expect(() =>
      openFolderWithKey(listing.root.keys!, root.opened.folderPrivateKey)
    ).toThrow()
    const newRoot = ownedFolderKeys(view(root.view.id), stored())!
    const visitor = openChildFolder(
      openFolderWithKey(listing.root.keys!, newRoot.folderPrivateKey),
      listing.trail[1].keys!
    )
    expect(openFolderFile(visitor, listing.files[0] as never)).toMatchObject({
      kind: 'file',
      opened: { name: 'holiday photo.png' },
    })
    expect(listing.files[0].id).toBe(file.id)
    // Keys change only while a folder waits for them.
    await expect(
      service.storeFolderKeys(owner, {
        folders: [
          {
            id: root.view.id,
            folderPublicKey: Uint8Array.from(root.opened.folderPublicKey),
            sealedFolderMetadata: Uint8Array.from(Buffer.alloc(60, 1)),
            sealedFolderPrivateKey: Uint8Array.from(Buffer.alloc(89, 1)),
          },
        ],
        parentStanzas: [],
      })
    ).rejects.toMatchObject({ status: 409, body: { code: 'keys_exist' } })
  })

  it('converts folders from before encryption, and makes stanzas for a new parent after a folder is deleted', async () => {
    // Folders that the account had before it got keys.
    const legacy = await prisma.vaultFolder.create({
      data: { userId: owner, name: 'Receipts', normalizedName: 'receipts' },
    })
    const legacyChild = await prisma.vaultFolder.create({
      data: {
        userId: owner,
        name: 'March',
        normalizedName: 'march',
        parentId: legacy.id,
      },
    })
    const file = await insertEncryptedFile(prisma, owner, encryptedFile(keys), {
      folderId: legacyChild.id,
    })
    expect(await repair()).toEqual({
      folderKeys: 2,
      parentStanzas: 1,
      fileStanzas: 1,
    })
    const rows = await prisma.vaultFolder.findMany({ where: { userId: owner } })
    expect(rows.map((row) => row.name)).toEqual(['', ''])
    let views = await service.listFolders(owner)
    expect(
      ownedFolderViews(views, stored())
        .map((view) => view.name)
        .sort()
    ).toEqual(['March', 'Receipts'])

    // Deleting the middle folder moves its file up to `Receipts`.
    const top = await newFolder('Top')
    const middle = await newFolder('Middle', top.view)
    const bottom = await newFolder('Bottom', middle.view)
    await service.moveFilesToFolder(owner, {
      fileIds: [file.id],
      folderId: middle.view.id,
    })
    await repair()
    await service.deleteFolder(owner, middle.view.id)
    expect(await service.folderRepairs(owner)).toMatchObject({
      parentStanzas: [{ id: bottom.view.id, parentId: top.view.id }],
      fileStanzas: [{ id: file.id, folderId: top.view.id }],
    })
    await repair()
    views = await service.listFolders(owner)
    const moved = views.find((view) => view.id === bottom.view.id)!
    expect(moved.parentId).toBe(top.view.id)
    // The stanza opens with the key of the new parent.
    expect(openChildFolder(top.opened, moved.keys!).folderPublicKey).toEqual(
      bottom.opened.folderPublicKey
    )
    expect(await service.folderRepairs(owner)).toMatchObject({
      folderKeys: [],
      parentStanzas: [],
      fileStanzas: [],
    })
  })
})
