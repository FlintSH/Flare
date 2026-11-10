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
  openSealedOcrText,
  sealedOcrTextRecord,
  sealedThumbnailRecord,
} from '@/lib/e2ee/client/files'
import { sealedTagRecord } from '@/lib/e2ee/client/tags'
import {
  type TagsApi,
  applyRuleToExistingFiles,
  sealPlainTags,
  tagRequestBody,
} from '@/lib/tags/client'
import { matchingRuleTagIds, ownedTagViews } from '@/lib/tags/owned'

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
  unwrapperOf,
} from './support'

const databaseUrl = process.env.FLARE_LIBRARY_DATABASE_URL

const state = vi.hoisted(() => ({
  ocr: true,
  session: null as null | { id: string },
}))
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
        ocr: { enabled: state.ocr },
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
vi.mock('@/lib/files/expiry', async (original) => ({
  ...(await original<object>()),
  getFilesExpirationInfo: async () => new Map(),
}))
// The session of a route request. API credentials are refused before this.
vi.mock('@/lib/http/access', async (original) => {
  const actual = await original<typeof import('@/lib/http/access')>()
  const { AccessError } = await import('@/lib/http/errors')
  return {
    ...actual,
    requireSession: async (
      request: Request,
      _permission?: unknown,
      options: { refuseApiCredentials?: boolean } = {}
    ) => {
      if (options.refuseApiCredentials) actual.refuseApiCredentials(request)
      if (!state.session) throw new AccessError(401, 'Authentication required')
      return { session: { user: state.session }, user: state.session }
    },
  }
})

vi.setConfig({ testTimeout: 30_000 })

describe.skipIf(!databaseUrl)(
  'sealed tags, pending work and the record sync (PostgreSQL)',
  () => {
    let prisma: typeof import('@/lib/database/prisma').prisma
    let manage: typeof import('@/lib/tags/manage')
    let tagService: typeof import('@/lib/tags/service')
    let records: typeof import('@/lib/files/library-records')
    let sync: typeof import('@/lib/files/sync')
    let finalize: typeof import('@/lib/uploads/finalize')
    let schema: typeof import('@/lib/tags/schema')
    let keys: TestKeys
    let owner: string

    beforeAll(async () => {
      libraryTestDatabaseUrl(databaseUrl!)
      prisma = (await import('@/lib/database/prisma')).prisma
      manage = await import('@/lib/tags/manage')
      tagService = await import('@/lib/tags/service')
      records = await import('@/lib/files/library-records')
      sync = await import('@/lib/files/sync')
      finalize = await import('@/lib/uploads/finalize')
      schema = await import('@/lib/tags/schema')
      const { ensureBuiltInRoles } = await import('@/lib/permissions/server')
      await prisma.$transaction((tx) => ensureBuiltInRoles(tx))
    })
    beforeEach(async () => {
      state.ocr = true
      keys = clientKeys()
      owner = (await createUser(prisma, keys)).id
      state.session = { id: owner }
    })
    afterAll(async () => {
      await prisma?.$disconnect()
    })

    const stored = () => storedKeys(owner, keys)
    const account = () => ({
      accountPrivateKey: keys.accountKeys.accountPrivateKey,
      accountPublicKey: keys.accountKeys.accountPublicKey,
    })
    async function sealedTag(
      name: string,
      ruleSource: 'filename' | 'ocr' | null = null,
      ruleText: string | null = null
    ) {
      return manage.createTag(
        owner,
        schema.tagInputSchema.parse({
          sealedTagMetadata: sealedTagRecord(account(), {
            name,
            ruleSource,
            ruleText,
          }),
        })
      )
    }
    const plainFile = (name: string, ocrText: string | null = null) =>
      prisma.file.create({
        data: {
          userId: owner,
          name,
          urlPath: `/${owner}/${randomUUID()}`,
          path: `uploads/${randomUUID()}`,
          mimeType: 'image/png',
          size: 1,
          ocrText,
        },
      })
    function tagsApi(): TagsApi {
      return {
        tags: () => manage.listTags(owner),
        seal: (tags) =>
          manage.sealTags(owner, schema.sealTagsInputSchema.parse({ tags })),
        plainText: (after) => sync.plainFileText(owner, after ?? null),
        encrypted: (since) => sync.syncEncryptedFiles(owner, since, 2),
        apply: async (tagId, fileIds) => ({
          count: await tagService.applyTagToFiles(owner, tagId, fileIds),
        }),
      }
    }
    const tagIdsOf = async (fileId: string) =>
      (
        await prisma.vaultFileTag.findMany({
          where: { fileId, excluded: false },
          select: { tagId: true },
        })
      ).map((row) => row.tagId)

    it('stores a sealed tag with no name and no rule, and refuses a plain one for an account that has keys', async () => {
      const tag = await sealedTag('Invoices', 'filename', 'invoice')
      const row = await prisma.vaultTag.findUniqueOrThrow({
        where: { id: tag.id },
      })
      expect(row).toMatchObject({
        name: '',
        normalizedName: `/sealed/${tag.id}`,
        ruleSource: null,
        ruleText: null,
      })
      expect(JSON.stringify(await manage.listTags(owner))).not.toMatch(
        /invoice/i
      )
      expect(ownedTagViews(await manage.listTags(owner), stored())).toEqual([
        expect.objectContaining({
          name: 'Invoices',
          ruleSource: 'filename',
          ruleText: 'invoice',
        }),
      ])
      await expect(
        manage.createTag(owner, {
          name: 'Plain',
          ruleSource: null,
          ruleText: null,
        })
      ).rejects.toMatchObject({ status: 409 })
      // The browser refuses a second tag with the same name (section 9.5.3).
      expect(() =>
        tagRequestBody({
          fields: { name: 'invoices', ruleSource: null, ruleText: null },
          tags: ownedTagViews([tag], stored()),
          keys: stored(),
        })
      ).toThrow('already have a tag')
      // An account without keys keeps plain tags.
      const legacy = (await createUser(prisma, null)).id
      await expect(
        manage.createTag(legacy, {
          name: 'Plain',
          ruleSource: 'filename',
          ruleText: 'x',
        })
      ).resolves.toMatchObject({ name: 'Plain', sealed: null })
      await expect(
        manage.createTag(
          legacy,
          schema.tagInputSchema.parse({
            sealedTagMetadata: sealedTagRecord(account(), {
              name: 'x',
              ruleSource: null,
              ruleText: null,
            }),
          })
        )
      ).rejects.toMatchObject({ status: 409 })
    })

    it('converts tags from before encryption in the owner’s browser and deletes their plain names', async () => {
      const plain = await prisma.vaultTag.create({
        data: {
          userId: owner,
          name: 'Receipts',
          normalizedName: 'receipts',
          ruleSource: 'ocr',
          ruleText: 'total due',
        },
      })
      const file = await plainFile('scan.png')
      await prisma.vaultFileTag.create({
        data: { fileId: file.id, tagId: plain.id },
      })
      expect(await sealPlainTags(tagsApi(), stored())).toBe(1)
      expect(await sealPlainTags(tagsApi(), stored())).toBe(0)
      const row = await prisma.vaultTag.findUniqueOrThrow({
        where: { id: plain.id },
      })
      expect(row).toMatchObject({ name: '', ruleSource: null, ruleText: null })
      // The same ID: files keep the tag and the filter by ID keeps working.
      expect(await tagIdsOf(file.id)).toEqual([plain.id])
      expect(ownedTagViews(await manage.listTags(owner), stored())).toEqual([
        expect.objectContaining({
          id: plain.id,
          name: 'Receipts',
          ruleSource: 'ocr',
          ruleText: 'total due',
          fileCount: 1,
        }),
      ])
    })

    it('applies a sealed rule to existing plain and encrypted files in the browser, and keeps removals', async () => {
      const tag = await sealedTag('Invoices', 'filename', 'INVOICE')
      const textTag = await sealedTag('Totals', 'ocr', 'total due')
      const plainHit = await plainFile('March invoice.pdf')
      const plainMiss = await plainFile('holiday.png', 'Total due: 5')
      const removed = await plainFile('invoice removed by hand.pdf')
      await prisma.vaultFileTag.create({
        data: { fileId: removed.id, tagId: tag.id, excluded: true },
      })
      const hit = encryptedFile(keys, 'Invoice 0042.png')
      const miss = encryptedFile(keys, 'cat.png')
      const encryptedHit = await insertEncryptedFile(prisma, owner, hit)
      const encryptedMiss = await insertEncryptedFile(prisma, owner, miss)
      await prisma.fileSealedData.create({
        data: {
          fileId: encryptedMiss.id,
          sealedOcrText: Buffer.from(
            sealedOcrTextRecord(miss, 'TOTAL DUE 12.00'),
            'base64url'
          ),
        },
      })
      const unwrapper = await unwrapperOf(stored())
      const [opened] = ownedTagViews([tag], stored())
      expect(await applyRuleToExistingFiles(tagsApi(), opened, unwrapper)).toBe(
        2
      )
      expect(await tagIdsOf(plainHit.id)).toEqual([tag.id])
      expect(await tagIdsOf(encryptedHit.id)).toEqual([tag.id])
      expect(await tagIdsOf(plainMiss.id)).toEqual([])
      expect(await tagIdsOf(removed.id)).toEqual([])
      // A rule on image text reads server text of a plain file and sealed
      // text of an encrypted one.
      const [openedText] = ownedTagViews([textTag], stored())
      expect(
        await applyRuleToExistingFiles(tagsApi(), openedText, unwrapper)
      ).toBe(2)
      expect(await tagIdsOf(plainMiss.id)).toEqual([textTag.id])
      expect(await tagIdsOf(encryptedMiss.id)).toEqual([textTag.id])
      // The server cannot apply a sealed rule.
      await expect(
        tagService.applyTagToExistingFiles(owner, tag.id)
      ).rejects.toMatchObject({ status: 409 })
    })

    it('sets the flags from what the uploader declares, whatever credential it used', async () => {
      const tag = await sealedTag('Shots', 'filename', 'screenshot')
      const upload = (
        extra: Record<string, string>,
        credential: 'session' | 'token' = 'session'
      ) =>
        finalize.finalizeUpload(
          encryptedUploadInput(
            { ...sessionUser(owner), credential },
            encryptedFile(keys, 'screenshot.png'),
            extra
          )
        )
      // A script client: no rules, an image, no thumbnail.
      // The legacy upload token sends plain files only (section 14.4).
      for (const credential of ['token', 'session'] as const)
        expect(
          await upload({ rulesApplied: 'false', isImage: 'true' }, credential)
        ).toMatchObject({
          rulesPending: true,
          ocrPending: true,
          thumbnailPending: true,
        })
      // Nothing declared is nothing done.
      expect(await upload({})).toMatchObject({
        rulesPending: true,
        ocrPending: false,
        thumbnailPending: true,
      })
      // A browser that did all the work.
      const created = encryptedFile(keys, 'screenshot 2.png')
      const done = await finalize.finalizeUpload(
        encryptedUploadInput(sessionUser(owner), created, {
          rulesApplied: 'true',
          ruleTagIds: `${tag.id},not-a-tag`,
          isImage: 'true',
          sealedOcrText: sealedOcrTextRecord(created, 'hello'),
          sealedThumbnail: sealedThumbnailRecord(created, new Uint8Array(40)),
        })
      )
      expect(done).toMatchObject({
        rulesPending: false,
        ocrPending: false,
        thumbnailPending: false,
      })
      expect(await tagIdsOf(done.id)).toEqual([tag.id])
      const sealed = await prisma.fileSealedData.findUniqueOrThrow({
        where: { fileId: done.id },
      })
      expect(openSealedOcrText(created, sealed.sealedOcrText!)).toBe('hello')
      // `thumbnail=none`, and an instance that does not read images itself.
      state.ocr = false
      expect(
        await upload({
          isImage: 'true',
          thumbnail: 'none',
          rulesApplied: 'true',
        })
      ).toMatchObject({
        rulesPending: false,
        ocrPending: false,
        thumbnailPending: false,
      })
      // An account without sealed tags has no rules that wait.
      const otherKeys = clientKeys()
      const other = await createUser(prisma, otherKeys)
      expect(
        await finalize.finalizeUpload(
          encryptedUploadInput(
            sessionUser(other.id),
            encryptedFile(otherKeys),
            {
              rulesApplied: 'false',
            }
          )
        )
      ).toMatchObject({ rulesPending: false })
    })

    it('lists the files that wait, takes the work of the owner only, and gives up on a file that keeps failing', async () => {
      const tag = await sealedTag('Shots', 'filename', 'screenshot')
      const created = encryptedFile(keys, 'screenshot.png')
      const file = await insertEncryptedFile(prisma, owner, created, {
        rulesPending: true,
        ocrPending: true,
        thumbnailPending: true,
      })
      const plain = await plainFile('screenshot plain.png', 'text')
      await prisma.file.update({
        where: { id: plain.id },
        data: { rulesPending: true },
      })
      const pending = await records.listPendingWork(owner)
      expect(pending.total).toBe(2)
      expect(pending.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: file.id,
            encrypted: true,
            ocrPending: true,
            encryption: expect.objectContaining({
              accountStanza: expect.any(String),
            }),
          }),
          expect.objectContaining({
            id: plain.id,
            encrypted: false,
            name: 'screenshot plain.png',
            ocrText: 'text',
          }),
        ])
      )
      // The browser of the owner does the work.
      const names = ownedTagViews(await manage.listTags(owner), stored())
      const work = records.fileWorkSchema.parse({
        sealedOcrText: sealedOcrTextRecord(created, 'A screenshot'),
        sealedThumbnail: sealedThumbnailRecord(created, new Uint8Array(64)),
        rulesApplied: true,
        ruleTagIds: matchingRuleTagIds(names, { name: 'screenshot.png' }),
      })
      expect(await records.recordFileWork(owner, file.id, work)).toMatchObject({
        rulesPending: false,
        ocrPending: false,
        thumbnailPending: false,
      })
      expect(await tagIdsOf(file.id)).toEqual([tag.id])
      // Another account cannot store work for this file.
      const stranger = (await createUser(prisma, clientKeys())).id
      await expect(
        records.recordFileWork(stranger, file.id, work)
      ).rejects.toMatchObject({ status: 404 })
      // A plain file takes rule tags and no sealed record.
      await expect(
        records.recordFileWork(
          owner,
          plain.id,
          records.fileWorkSchema.parse({ ocr: 'none' })
        )
      ).rejects.toMatchObject({ status: 400 })
      await records.recordFileWork(
        owner,
        plain.id,
        records.fileWorkSchema.parse({
          rulesApplied: true,
          ruleTagIds: [tag.id],
        })
      )
      expect(await tagIdsOf(plain.id)).toEqual([tag.id])
      expect((await records.listPendingWork(owner)).total).toBe(0)

      // A file that fails three times is not listed again.
      const stuck = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys),
        {
          thumbnailPending: true,
        }
      )
      for (
        let attempt = 1;
        attempt <= records.PENDING_ATTEMPT_LIMIT;
        attempt++
      ) {
        expect((await records.listPendingWork(owner)).total).toBe(1)
        await records.recordFileWork(
          owner,
          stuck.id,
          records.fileWorkSchema.parse({ failed: true })
        )
      }
      expect((await records.listPendingWork(owner)).total).toBe(0)
    })

    it('refuses work from a token, a visitor and a body with plaintext', async () => {
      const { POST } = await import('@/app/api/files/[id]/work/route')
      const created = encryptedFile(keys)
      const file = await insertEncryptedFile(prisma, owner, created, {
        ocrPending: true,
      })
      const send = (body: unknown, headers: Record<string, string> = {}) =>
        POST(
          new Request(`http://localhost/api/files/${file.id}/work`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ id: file.id }) }
        )
      const sealedOcrText = sealedOcrTextRecord(created, 'secret words')
      expect(
        (await send({ sealedOcrText }, { Authorization: 'Bearer flare_x' }))
          .status
      ).toBe(401)
      state.session = null
      // A visitor who has the file key can make a valid record (section 9.6.3).
      expect((await send({ sealedOcrText })).status).toBe(401)
      state.session = { id: owner }
      expect((await send({ ocrText: 'secret words' })).status).toBe(400)
      expect((await send({ sealedOcrText, name: 'x' })).status).toBe(400)
      expect((await send({ sealedOcrText: 'AAAA' })).status).toBe(400)
      expect((await send({ sealedOcrText })).status).toBe(200)
      expect(
        await prisma.fileSealedData.findUnique({ where: { fileId: file.id } })
      ).not.toBeNull()
    })

    it('syncs encrypted records by a cursor and shows every difference in its state', async () => {
      const first = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys)
      )
      const second = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys)
      )
      await plainFile('not in the cache.png')
      await insertEncryptedFile(prisma, owner, encryptedFile(keys), {
        unreadable: true,
      })
      const digest = (list: { seq: number }[]) => ({
        count: list.length,
        sum: String(list.reduce((sum, entry) => sum + entry.seq, 0)),
      })
      let page = await sync.syncEncryptedFiles(owner, 0, 1)
      expect(page.more).toBe(true)
      expect(page.records.map((record) => record.id)).toEqual([first.id])
      const cache = new Map(page.records.map((record) => [record.id, record]))
      page = await sync.syncEncryptedFiles(owner, page.records[0].seq, 10)
      for (const record of page.records) cache.set(record.id, record)
      expect([...cache.keys()].sort()).toEqual([first.id, second.id].sort())
      expect(page.more).toBe(false)
      expect(page.state).toEqual(digest([...cache.values()]))
      expect(JSON.stringify(page)).not.toContain('holiday photo')
      const cursor = Math.max(...[...cache.values()].map((entry) => entry.seq))

      // A new tag, a new text, a move and a new visibility each move the cursor.
      const tag = await sealedTag('Any')
      const changes = [
        () =>
          tagService.changeFileTags(owner, {
            fileIds: [first.id],
            tagId: tag.id,
            action: 'add',
          }),
        () =>
          records.recordFileWork(
            owner,
            first.id,
            records.fileWorkSchema.parse({
              sealedOcrText: sealedOcrTextRecord(encryptedFile(keys), 'x'),
            })
          ),
        () =>
          prisma.file.update({
            where: { id: first.id },
            data: { visibility: 'PRIVATE' },
          }),
      ]
      let since = cursor
      for (const change of changes) {
        await change()
        const next = await sync.syncEncryptedFiles(owner, since)
        expect(next.records.map((record) => record.id)).toEqual([first.id])
        since = next.records[0].seq
        cache.set(first.id, next.records[0])
      }
      expect(cache.get(first.id)).toMatchObject({
        visibility: 'PRIVATE',
        tags: [{ id: tag.id, name: '' }],
        sealedOcrText: expect.any(String),
      })
      // A view does not move it.
      await prisma.file.update({
        where: { id: first.id },
        data: { views: { increment: 1 } },
      })
      expect((await sync.syncEncryptedFiles(owner, since)).records).toEqual([])

      // A deleted file shows in the state, and the index names what is left.
      await prisma.file.delete({ where: { id: second.id } })
      const after = await sync.syncEncryptedFiles(owner, since)
      expect(after.records).toEqual([])
      expect(after.state).not.toEqual(digest([...cache.values()]))
      const index = await sync.syncIndex(owner, null)
      expect(index.entries).toEqual([[first.id, cache.get(first.id)!.seq]])
      expect(
        (await sync.syncFilesById(owner, [first.id, second.id])).records.map(
          (record) => record.id
        )
      ).toEqual([first.id])
      // Another account reads none of it.
      const stranger = (await createUser(prisma, clientKeys())).id
      expect((await sync.syncEncryptedFiles(stranger, 0)).records).toEqual([])
      expect((await sync.syncFilesById(stranger, [first.id])).records).toEqual(
        []
      )
    })
    it('lists the plain matches of a view as IDs and sort keys, and never an encrypted file', async () => {
      const { plainFileOrder } = await import('@/lib/files/order')
      const { fileListFilters } = await import('@/lib/files/list-filters')
      const report = await plainFile('Quarterly report.pdf')
      const photo = await plainFile('holiday.png', 'the report is late')
      await plainFile('other.png')
      const secret = await insertEncryptedFile(
        prisma,
        owner,
        encryptedFile(keys, 'secret report.png')
      )
      const order = (query: string) =>
        plainFileOrder(owner, new URLSearchParams(query), null)
      // The search of the server reaches plain names and plain text only.
      const found = await order('search=REPORT&sortBy=name')
      expect(found.more).toBe(false)
      expect(new Map(found.keys)).toEqual(
        new Map([
          [report.id, 'Quarterly report.pdf'],
          [photo.id, 'holiday.png'],
        ])
      )
      // A type filter for the generic type does not list encrypted files.
      expect((await order('types=application/octet-stream')).keys).toEqual([])
      const byDate = await order('sortBy=newest')
      expect(byDate.keys).toHaveLength(3)
      expect(
        byDate.keys.every(([, key]) => /^\d{4}-.*Z$/.test(String(key)))
      ).toBe(true)
      expect(byDate.keys.map(([id]) => id)).not.toContain(secret.id)
      // Pages by ID.
      const first = byDate.keys[0][0]
      expect(
        (await plainFileOrder(owner, new URLSearchParams(), first)).keys
      ).toHaveLength(2)
      // The list API takes the same filter.
      const count = (query: string) =>
        prisma.file.count({
          where: fileListFilters(owner, new URLSearchParams(query)).where,
        })
      expect(await count('encrypted=false')).toBe(3)
      expect(await count('encrypted=true')).toBe(1)
      expect(await count('')).toBe(4)
      expect(() =>
        fileListFilters(owner, new URLSearchParams('encrypted=yes'))
      ).toThrow('encrypted must be true or false')
    })
  }
)
