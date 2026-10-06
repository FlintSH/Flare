import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const state = vi.hoisted(() => ({
  userId: 'archive-owner',
  version: 1,
  objects: new Map<string, Buffer>(),
  onUpload: undefined as undefined | (() => Promise<void>),
  onRead: undefined as undefined | (() => Promise<void>),
  targetChanged: false,
  targets: [] as unknown[],
  ocr: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => {
    if (!state.userId) return null
    const { getUserAccess } = await import('@/lib/permissions/server')
    return {
      user: {
        id: state.userId,
        sessionVersion: state.version,
        ...(await getUserAccess(state.userId)),
      },
    }
  },
}))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: state.ocr } }))
vi.mock('@/lib/storage', () => ({ getStorageProvider: async () => storage }))
vi.mock('@/lib/storage/target-provider', () => ({
  StorageTargetChangedError: class extends Error {},
  getStorageProviderForTarget: async (target: unknown) => {
    state.targets.push(target)
    if (state.targetChanged) throw new Error('Recorded backend unavailable')
    return storage
  },
}))

const storage = {
  kind: 'local' as const,
  target: { provider: 'local' as const },
  async getFileStream(
    path: string,
    range?: { start?: number; end?: number },
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted()
    const bytes = state.objects.get(path)
    if (!bytes) throw new Error('Missing fixture object')
    await state.onRead?.()
    return Readable.from([
      range
        ? bytes.subarray(
            range.start ?? 0,
            range.end === undefined ? undefined : range.end + 1
          )
        : bytes,
    ])
  },
  async uploadStream(stream: Readable, path: string) {
    const chunks = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    state.objects.set(path, bytes)
    await state.onUpload?.()
    return { size: bytes.length }
  },
}

const databaseUrl = process.env.FLARE_ARCHIVE_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('archive publication against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let codec: typeof import('@/lib/archives/codec')
  let listing: typeof import('@/app/api/files/[id]/archive/route')
  let extraction: typeof import('@/app/api/files/[id]/archive/extract/route')
  let creation: typeof import('@/app/api/files/archive/route')
  let download: typeof import('@/app/api/files/[id]/archive/entry/route')
  let sharedListing: typeof import('@/app/api/files/[id]/archive/share/route')
  let sharedDownload: typeof import('@/app/api/files/[id]/archive/share/entry/route')
  let profileListing: typeof import('@/app/api/upload-profiles/route')
  let shareIp: string
  let defaultConfig: typeof import('@/lib/config').DEFAULT_CONFIG
  let defaultPermissions: string[]

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['/flare_archive_test_local', '/flare_archive_test_ci'].includes(
        url.pathname
      ) ||
      [...url.searchParams].some(
        ([key, value]) => key !== 'schema' || value !== 'public'
      )
    )
      throw new Error(
        'Use the exact disposable local flare_archive_test_local or flare_archive_test_ci database with public schema.'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    codec = await import('@/lib/archives/codec')
    listing = await import('@/app/api/files/[id]/archive/route')
    extraction = await import('@/app/api/files/[id]/archive/extract/route')
    creation = await import('@/app/api/files/archive/route')
    download = await import('@/app/api/files/[id]/archive/entry/route')
    sharedListing = await import('@/app/api/files/[id]/archive/share/route')
    sharedDownload =
      await import('@/app/api/files/[id]/archive/share/entry/route')
    profileListing = await import('@/app/api/upload-profiles/route')
    defaultConfig = (await import('@/lib/config')).DEFAULT_CONFIG
    defaultPermissions = [
      ...(await import('@/lib/permissions/catalog')).DEFAULT_PERMISSIONS,
    ]
  })
  beforeEach(async () => {
    state.userId = 'archive-owner'
    state.version = 1
    shareIp = `archive-test-${randomUUID()}`
    state.objects.clear()
    state.targets = []
    state.targetChanged = false
    state.onUpload = undefined
    state.onRead = undefined
    state.ocr.mockResolvedValue(undefined)
    await prisma.storageDeletion.deleteMany()
    await prisma.event.deleteMany()
    await prisma.vaultFolder.deleteMany()
    await prisma.user.deleteMany()
    await prisma.role.deleteMany()
    await prisma.config.deleteMany()
    await prisma.role.create({
      data: {
        name: 'Everyone',
        systemKey: 'everyone',
        permissions: defaultPermissions,
        position: 0,
      },
    })
    for (const id of ['archive-owner', 'archive-other'])
      await prisma.user.create({
        data: { id, urlId: id, uploadToken: id, email: `${id}@example.test` },
      })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function request(
    path: string,
    data?: unknown,
    headers?: Record<string, string>
  ) {
    return new Request(`http://localhost${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
  }
  function context(id: string) {
    return { params: Promise.resolve({ id }) }
  }
  async function waitForArchiveRelease(key: string) {
    await vi.waitFor(async () => {
      const { ArchiveOperation } = await import('@/lib/archives/operation')
      const operation = new ArchiveOperation(key, new AbortController().signal)
      await operation.release()
    })
  }

  async function source(name: string, bytes: Buffer, userId = 'archive-owner') {
    const path = `uploads/${userId}/${randomUUID()}`
    state.objects.set(path, bytes)
    const file = await prisma.file.create({
      data: {
        userId,
        name,
        path,
        urlPath: `/${userId}/${randomUUID()}`,
        size: bytes.length / 1024 ** 2,
        mimeType: name.endsWith('.zip') ? 'application/zip' : 'text/plain',
        storageTarget: { provider: 'local' },
        visibility: 'PRIVATE',
        password: 'source-password-hash',
      },
    })
    await prisma.user.update({
      where: { id: userId },
      data: { storageUsed: { increment: file.size } },
    })
    return file
  }
  async function archive(
    entries = [
      { path: 'notes/readme.txt', data: 'Hello archive' },
      { path: 'empty.bin', data: '' },
    ]
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'archive-test-'))
    try {
      const inputs = []
      for (const entry of entries) {
        const path = join(directory, randomUUID())
        await writeFile(path, entry.data)
        inputs.push({
          path: entry.path,
          localPath: path,
          size: Buffer.byteLength(entry.data),
        })
      }
      const output = join(directory, 'source.zip')
      await codec.createArchive(output, 'zip', inputs)
      return source('source.zip', await readFile(output))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  async function setConfig(change: (config: typeof defaultConfig) => void) {
    const config = structuredClone(defaultConfig)
    change(config)
    await prisma.config.upsert({
      where: { key: 'flare_config' },
      create: {
        key: 'flare_config',
        value: JSON.parse(JSON.stringify(config)),
      },
      update: { value: JSON.parse(JSON.stringify(config)) },
    })
  }
  async function extract(
    id: string,
    input = { folderId: null as string | null, name: 'Extracted' },
    headers?: Record<string, string>
  ) {
    return extraction.POST(
      request(`/api/files/${id}/archive/extract`, input, headers),
      context(id)
    )
  }

  function sharedRequest(
    id: string,
    data: unknown = {},
    entry = false,
    headers: Record<string, string> = {}
  ) {
    return request(
      `/api/files/${id}/archive/share${entry ? '/entry' : ''}`,
      data,
      {
        'X-Forwarded-For': shareIp,
        ...headers,
      }
    )
  }

  async function publicArchive(password: string | null = null) {
    const file = await archive()
    return prisma.file.update({
      where: { id: file.id },
      data: {
        visibility: 'PUBLIC',
        password: password ? await hash(password, 4) : null,
      },
    })
  }

  it('audits owner archive reads and extraction with the source identity and every published member', async () => {
    const file = await archive()
    await prisma.auditEvent.deleteMany()
    expect(
      (
        await listing.GET(
          request(`/api/files/${file.id}/archive`),
          context(file.id)
        )
      ).status
    ).toBe(200)
    const entry = await download.GET(
      request(`/api/files/${file.id}/archive/entry?path=notes%2Freadme.txt`),
      context(file.id)
    )
    expect(await entry.text()).toBe('Hello archive')
    await waitForArchiveRelease('archive-owner')
    expect((await extract(file.id)).status).toBe(200)
    const events = await prisma.auditEvent.findMany({
      where: { category: 'archives' },
    })
    expect(
      events.find((event) => event.action === 'archive.extract')
    ).toMatchObject({
      actorId: 'archive-owner',
      actorName: 'archive-owner',
      targetId: file.id,
      targetName: 'source.zip',
      outcome: 'success',
    })
    expect(
      events.find((event) => event.action === 'archive.member.read')
    ).toMatchObject({
      targetId: file.id,
      targetName: 'source.zip',
      details: { name: 'notes/readme.txt', size: 13 },
    })
    const extracted = events.filter(
      (event) => event.action === 'archive.member.extract'
    )
    expect(extracted).toHaveLength(2)
    expect(extracted.map((event) => event.targetName).sort()).toEqual([
      'empty.bin',
      'readme.txt',
    ])
    for (const event of extracted) {
      expect(event).toMatchObject({
        actorId: 'archive-owner',
        details: { fileId: file.id },
      })
      expect(event.targetId).not.toBe(file.id)
    }
    expect(JSON.stringify(events)).not.toMatch(
      /Hello archive|source-password-hash|flare-archive-|uploads\//
    )
  })

  it('audits every archive-creation source and binds success or failure to the intended output', async () => {
    const one = await source('First.txt', Buffer.from('source-content-one'))
    const two = await source('Second.txt', Buffer.from('source-content-two'))
    await prisma.auditEvent.deleteMany()
    const input = {
      fileIds: [one.id, two.id],
      name: 'Collected',
      format: 'zip',
      folderId: null,
    }
    const response = await creation.POST(request('/api/files/archive', input))
    expect(response.status).toBe(200)
    const output = (await response.json()).data.file
    const events = await prisma.auditEvent.findMany({
      where: { category: 'archives' },
    })
    expect(
      events
        .filter((event) => event.action === 'archive.source.read')
        .map((event) => event.targetName)
        .sort()
    ).toEqual(['First.txt', 'Second.txt'])
    expect(
      events.find((event) => event.action === 'archive.create')
    ).toMatchObject({
      actorId: 'archive-owner',
      targetId: output.id,
      targetName: 'Collected.zip',
      outcome: 'success',
    })
    state.objects.delete(one.path)
    expect(
      (
        await creation.POST(
          request('/api/files/archive', { ...input, name: 'Failed output' })
        )
      ).status
    ).toBe(500)
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'archive.source.read', outcome: 'failure' },
      })
    ).toMatchObject({ targetId: one.id, targetName: 'First.txt' })
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'archive.create', outcome: 'failure' },
      })
    ).toMatchObject({ targetId: null, targetName: 'Failed output.zip' })
    expect(
      JSON.stringify(
        await prisma.auditEvent.findMany({ where: { category: 'archives' } })
      )
    ).not.toMatch(/source-content|Missing fixture object|uploads\//)
  })

  it('audits anonymous shared-member access and password/private denials without credentials', async () => {
    const file = await publicArchive('archive-password-fixture')
    state.userId = ''
    await prisma.auditEvent.deleteMany()
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, { password: 'wrong-password-fixture' }),
          context(file.id)
        )
      ).status
    ).toBe(401)
    await prisma.file.update({
      where: { id: file.id },
      data: { visibility: 'PRIVATE' },
    })
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, { password: 'archive-password-fixture' }),
          context(file.id)
        )
      ).status
    ).toBe(404)
    await prisma.file.update({
      where: { id: file.id },
      data: { visibility: 'PUBLIC' },
    })
    const response = await sharedDownload.POST(
      sharedRequest(
        file.id,
        { path: 'notes/readme.txt', password: 'archive-password-fixture' },
        true
      ),
      context(file.id)
    )
    expect(await response.text()).toBe('Hello archive')
    await waitForArchiveRelease(`share:${file.id}`)
    state.onRead = async () => {
      state.onRead = undefined
      await prisma.file.update({
        where: { id: file.id },
        data: { visibility: 'PRIVATE' },
      })
    }
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, { password: 'archive-password-fixture' }),
          context(file.id)
        )
      ).status
    ).toBe(404)
    const events = await prisma.auditEvent.findMany({
      where: { category: 'archives' },
    })
    expect(
      events
        .filter((event) => event.action === 'archive.browse')
        .map((event) => event.outcome)
    ).toEqual(['denied', 'denied', 'denied'])
    expect(
      events.find((event) => event.action === 'archive.member.read')
    ).toMatchObject({
      actorId: null,
      actorName: 'Anonymous',
      targetId: file.id,
      targetName: 'source.zip',
      details: { name: 'notes/readme.txt' },
    })
    expect(JSON.stringify(events)).not.toMatch(
      /password-fixture|Hello archive|source-password-hash|uploads\//
    )
  })

  it('lets anonymous share visitors browse and download JSON or form entries without exposing credentials or changing account data', async () => {
    const file = await publicArchive('sender secret')
    state.userId = ''
    const response = await sharedListing.POST(
      sharedRequest(file.id, { password: 'sender secret' }),
      context(file.id)
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      format: 'zip',
      fileCount: 2,
      totalBytes: 13,
    })
    for (const value of [
      'diskPath',
      'storageTarget',
      'sender secret',
      file.password!,
      file.userId,
    ])
      expect(JSON.stringify(body)).not.toContain(value)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    for (const form of [false, true]) {
      const data = { path: 'notes/readme.txt', password: 'sender secret' }
      const request = form
        ? new Request(
            `http://localhost/api/files/${file.id}/archive/share/entry`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Origin: 'http://localhost',
                'X-Forwarded-For': shareIp,
              },
              body: new URLSearchParams(data),
            }
          )
        : sharedRequest(file.id, data, true)
      const entry = await sharedDownload.POST(request, context(file.id))
      expect(entry.status).toBe(200)
      expect(entry.headers.get('content-disposition')).toContain('attachment')
      expect(entry.headers.get('content-type')).toBe('application/octet-stream')
      expect(entry.headers.get('x-content-type-options')).toBe('nosniff')
      expect(entry.headers.get('content-security-policy')).toContain('sandbox')
      expect(await entry.text()).toBe('Hello archive')
      // The response stream owns its slot until filesystem cleanup finishes.
      await vi.waitFor(async () => {
        const { ArchiveOperation } = await import('@/lib/archives/operation')
        const operation = new ArchiveOperation(
          `share:${file.id}`,
          new AbortController().signal
        )
        await operation.release()
      })
    }
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.vaultFolder.count()).toBe(0)
    expect(await prisma.event.count()).toBe(0)
  })

  it('applies live share owner/moderator access while keeping private files private and owner archive APIs owner-only', async () => {
    const file = await archive()
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
    state.userId = 'archive-other'
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, { password: 'irrelevant' }),
          context(file.id)
        )
      ).status
    ).toBe(404)
    await prisma.role.update({
      where: { systemKey: 'everyone' },
      data: { permissions: ['content.read'] },
    })
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
    expect(
      (
        await listing.GET(
          request(`/api/files/${file.id}/archive`),
          context(file.id)
        )
      ).status
    ).toBe(403)
    await prisma.role.update({
      where: { systemKey: 'everyone' },
      data: { permissions: [] },
    })
    state.userId = 'archive-owner'
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(404)
    await prisma.file.update({
      where: { id: file.id },
      data: { visibility: 'PUBLIC', password: null },
    })
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
    state.userId = ''
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
  })

  it('rejects missing/wrong passwords, private visibility, stale privileged sessions, bearer headers, and cross-origin requests before reading storage', async () => {
    const file = await publicArchive('correct')
    state.userId = ''
    state.onRead = vi.fn()
    for (const data of [{}, { password: 'wrong' }])
      expect(
        (
          await sharedListing.POST(
            sharedRequest(file.id, data),
            context(file.id)
          )
        ).status
      ).toBe(401)
    await prisma.file.update({
      where: { id: file.id },
      data: { visibility: 'PRIVATE' },
    })
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, { password: 'correct' }),
          context(file.id)
        )
      ).status
    ).toBe(404)
    state.userId = 'archive-owner'
    state.version = 0
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(404)
    state.version = 1
    for (const authorization of ['Bearer named', 'Bearer legacy', ''])
      expect(
        (
          await sharedListing.POST(
            sharedRequest(file.id, {}, false, { Authorization: authorization }),
            context(file.id)
          )
        ).status
      ).toBe(401)
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, {}, false, { Origin: 'https://other.test' }),
          context(file.id)
        )
      ).status
    ).toBe(403)
    expect(
      (
        await sharedDownload.POST(
          sharedRequest(file.id, { path: 'notes/readme.txt' }, true, {
            'Sec-Fetch-Site': 'cross-site',
          }),
          context(file.id)
        )
      ).status
    ).toBe(403)
    expect(state.onRead).not.toHaveBeenCalled()
  })

  it('bounds shared bodies and rejects unknown/duplicate form fields and invalid members', async () => {
    const file = await publicArchive()
    state.userId = ''
    for (const data of [
      { password: null },
      { password: 'x'.repeat(1025) },
      { unknown: true },
    ])
      expect(
        (
          await sharedListing.POST(
            sharedRequest(file.id, data),
            context(file.id)
          )
        ).status
      ).toBe(400)
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, { password: 'x'.repeat(16384) }),
          context(file.id)
        )
      ).status
    ).toBe(413)
    expect(
      (
        await sharedListing.POST(
          sharedRequest(file.id, {}, false, { 'Content-Type': 'text/plain' }),
          context(file.id)
        )
      ).status
    ).toBe(415)
    for (const body of [
      'path=a&path=b',
      'path=a&unexpected=true',
      'password=a',
    ]) {
      const request = new Request(
        `http://localhost/api/files/${file.id}/archive/share/entry`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Forwarded-For': shareIp,
          },
          body,
        }
      )
      expect(
        (await sharedDownload.POST(request, context(file.id))).status
      ).toBe(400)
    }
    expect(
      (
        await sharedDownload.POST(
          sharedRequest(file.id, { path: '../outside' }, true),
          context(file.id)
        )
      ).status
    ).toBe(404)
    expect(
      (
        await sharedDownload.POST(
          sharedRequest(file.id, { path: 'notes' }, true),
          context(file.id)
        )
      ).status
    ).toBe(404)
    expect(await prisma.file.count()).toBe(1)
  })

  it.each([
    'private',
    'password',
    'deleted',
    'path',
    'target',
    'session',
    'role',
  ] as const)(
    'rechecks shared archive access after staging when %s changes',
    async (change) => {
      const file = await publicArchive('correct')
      const privileged = ['session', 'role'].includes(change)
      if (privileged)
        await prisma.file.update({
          where: { id: file.id },
          data: { visibility: 'PRIVATE' },
        })
      else state.userId = ''
      state.onRead = async () => {
        state.onRead = undefined
        if (change === 'private')
          await prisma.file.update({
            where: { id: file.id },
            data: { visibility: 'PRIVATE' },
          })
        if (change === 'password')
          await prisma.file.update({
            where: { id: file.id },
            data: { password: await hash('replacement', 4) },
          })
        if (change === 'deleted')
          await prisma.file.delete({ where: { id: file.id } })
        if (change === 'path')
          await prisma.file.update({
            where: { id: file.id },
            data: { path: 'changed/path' },
          })
        if (change === 'target')
          await prisma.file.update({
            where: { id: file.id },
            data: { storageTarget: { provider: 's3', bucket: 'changed' } },
          })
        if (change === 'session')
          await prisma.user.update({
            where: { id: 'archive-owner' },
            data: { sessionVersion: { increment: 1 } },
          })
        if (change === 'role')
          await prisma.role.update({
            where: { systemKey: 'everyone' },
            data: { permissions: [] },
          })
      }
      const response = await sharedDownload.POST(
        sharedRequest(
          file.id,
          { path: 'notes/readme.txt', password: 'correct' },
          true
        ),
        context(file.id)
      )
      expect(response.status).toBe(
        {
          private: 404,
          password: 401,
          deleted: 404,
          path: 409,
          target: 409,
          session: 404,
          role: 404,
        }[change]
      )
      expect(response.headers.get('content-disposition')).toBeNull()
      expect(await prisma.vaultFolder.count()).toBe(0)
    }
  )

  it('uses worker-applied expiration and canonical sharing independently of folder discovery', async () => {
    const file = await publicArchive()
    const folder = await prisma.vaultFolder.create({
      data: {
        userId: 'archive-owner',
        name: 'Collection',
        normalizedName: 'collection',
        shareToken: 'public_collection_token_1234',
      },
    })
    await prisma.file.update({
      where: { id: file.id },
      data: {
        folderId: folder.id,
        uploadOptions: {
          expiresAt: '2020-01-01T00:00:00.000Z',
          expiryAction: 'SET_PRIVATE',
        },
      },
    })
    state.userId = ''
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
    await prisma.vaultFolder.update({
      where: { id: folder.id },
      data: { shareToken: null },
    })
    await prisma.file.update({
      where: { id: file.id },
      data: { folderId: null },
    })
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
    // This is the state change performed by the expiration worker.
    await prisma.file.update({
      where: { id: file.id },
      data: { visibility: 'PRIVATE' },
    })
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(404)
  })

  it('finishes concurrent source deletion without a reader/quota lock-order deadlock', async () => {
    const file = await archive()
    let releaseDeletion!: () => void
    let deleted!: () => void
    let deletingPid = 0
    const gate = new Promise<void>((resolve) => {
      releaseDeletion = resolve
    })
    const deleteStarted = new Promise<void>((resolve) => {
      deleted = resolve
    })
    let deletion: Promise<unknown> | undefined
    state.onRead = async () => {
      state.onRead = undefined
      deletion = prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`
          deletingPid = row.pid
          // Existing file DELETE locks its file before decrementing account quota.
          await tx.file.delete({ where: { id: file.id } })
          deleted()
          await gate
          await tx.user.update({
            where: { id: file.userId },
            data: { storageUsed: { decrement: file.size } },
          })
        },
        { timeout: 10000 }
      )
      await deleteStarted
    }
    const response = sharedListing.POST(
      sharedRequest(file.id),
      context(file.id)
    )
    await deleteStarted
    try {
      // Synchronize on a real lock wait, not a delay or an internal function spy.
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${deletingPid} = ANY(pg_blocking_pids(pid))
          ) AS blocked
        `
        expect(row.blocked).toBe(true)
      })
    } finally {
      releaseDeletion()
    }
    await deletion
    expect((await response).status).toBe(404)
    expect(await prisma.file.findUnique({ where: { id: file.id } })).toBeNull()
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: file.userId } }))
        .storageUsed
    ).toBe(0)
  })

  it('shares the 30-per-IP minute budget across manifest and entry endpoints before archive I/O', async () => {
    state.userId = ''
    state.onRead = vi.fn()
    for (let index = 0; index < 30; index++) {
      const response =
        index % 2
          ? await sharedDownload.POST(
              sharedRequest('absent', { path: 'a' }, true),
              context('absent')
            )
          : await sharedListing.POST(sharedRequest('absent'), context('absent'))
      expect(response.status).toBe(404)
    }
    const blocked = await sharedListing.POST(
      sharedRequest('absent'),
      context('absent')
    )
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
    expect(state.onRead).not.toHaveBeenCalled()
  })

  it('serializes shared work by source file and releases its slot after completion', async () => {
    const file = await publicArchive()
    state.userId = ''
    let unblock!: () => void
    let started!: () => void
    const staged = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      unblock = resolve
    })
    state.onRead = async () => {
      started()
      await gate
    }
    const first = sharedListing.POST(sharedRequest(file.id), context(file.id))
    await staged
    try {
      const second = await sharedDownload.POST(
        sharedRequest(file.id, { path: 'empty.bin' }, true),
        context(file.id)
      )
      expect(second.status).toBe(429)
      expect(second.headers.get('retry-after')).toBe('5')
    } finally {
      unblock()
    }
    expect((await first).status).toBe(200)
    state.onRead = undefined
    expect(
      (await sharedListing.POST(sharedRequest(file.id), context(file.id)))
        .status
    ).toBe(200)
  })

  it('lists and downloads owned entries without exposing temporary paths or modifying the account', async () => {
    const file = await archive()
    const response = await listing.GET(
      request(`/api/files/${file.id}/archive`),
      context(file.id)
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      format: 'zip',
      fileCount: 2,
      totalBytes: 13,
    })
    expect(JSON.stringify(body)).not.toContain('diskPath')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const entry = await download.GET(
      request(`/api/files/${file.id}/archive/entry?path=notes%2Freadme.txt`),
      context(file.id)
    )
    expect(entry.headers.get('content-type')).toBe('application/octet-stream')
    expect(entry.headers.get('content-disposition')).toContain('attachment')
    expect(await entry.text()).toBe('Hello archive')
    expect(await prisma.file.count()).toBe(1)
  })
  it('rejects bearer credentials, other owners, stale sessions, missing permissions, and cross-site writes', async () => {
    const file = await archive()
    for (const authorization of ['Bearer flr_example', 'Bearer legacy', ''])
      expect(
        (
          await listing.GET(
            request(`/api/files/${file.id}/archive`, undefined, {
              Authorization: authorization,
            }),
            context(file.id)
          )
        ).status
      ).toBe(401)
    state.userId = 'archive-other'
    expect(
      (
        await listing.GET(
          request(`/api/files/${file.id}/archive`),
          context(file.id)
        )
      ).status
    ).toBe(404)
    state.userId = 'archive-owner'
    state.version = 0
    expect((await extract(file.id)).status).toBe(401)
    state.version = 1
    expect(
      (
        await extract(file.id, undefined, {
          Origin: 'https://attacker.invalid',
        })
      ).status
    ).toBe(403)
    await prisma.role.update({
      where: { systemKey: 'everyone' },
      data: { permissions: ['files.read'] },
    })
    expect((await extract(file.id)).status).toBe(403)
    expect(await prisma.file.count()).toBe(1)
  })
  it('atomically extracts a private folder tree, preserves zero-byte files and sources, and bypasses the account default profile', async () => {
    const profile = await prisma.uploadProfile.create({
      data: {
        userId: 'archive-owner',
        name: 'Public default',
        options: { visibility: 'PUBLIC', expiration: 'HOUR' },
      },
    })
    await prisma.user.update({
      where: { id: 'archive-owner' },
      data: { defaultUploadProfileId: profile.id },
    })
    const file = await archive()
    const response = await extract(file.id)
    expect(response.status).toBe(200)
    const result = (await response.json()).data
    expect(result).toMatchObject({ fileCount: 2, totalBytes: 13 })
    const outputs = await prisma.file.findMany({
      where: { id: { not: file.id } },
      include: { folder: true },
    })
    expect(outputs).toHaveLength(2)
    expect(
      outputs.every(
        (output) => output.visibility === 'PRIVATE' && output.password === null
      )
    ).toBe(true)
    expect(outputs.find((output) => output.name === 'empty.bin')?.size).toBe(0)
    expect(
      outputs.find((output) => output.name === 'readme.txt')?.folder?.name
    ).toBe('notes')
    expect(
      outputs.find((output) => output.name === 'readme.txt')?.mimeType
    ).toBe('text/plain')
    expect(await prisma.event.count()).toBe(0)
    expect(
      await prisma.file.findUnique({ where: { id: file.id } })
    ).toMatchObject({ password: 'source-password-hash', visibility: 'PRIVATE' })
    expect(state.targets).toContainEqual({ provider: 'local' })
  })
  it('applies an explicitly chosen profile to every output with one expiration and atomic file-ready events', async () => {
    const tag = await prisma.vaultTag.create({
      data: {
        userId: 'archive-owner',
        name: 'Profile tag',
        normalizedName: 'profile tag',
      },
    })
    const profile = await prisma.uploadProfile.create({
      data: {
        userId: 'archive-owner',
        name: 'Handoff',
        options: {
          visibility: 'PUBLIC',
          expiration: 'HOUR',
          tagIds: [tag.id],
          randomizeFileUrls: true,
          shareStyle: 'delivery',
        },
      },
    })
    await prisma.webhook.create({
      data: {
        userId: 'archive-owner',
        name: 'Ready',
        url: 'https://example.invalid/hook',
        secret: 'unused-fixture-secret',
      },
    })
    const file = await archive()
    const response = await extraction.POST(
      request(`/api/files/${file.id}/archive/extract`, {
        name: 'Profile output',
        folderId: null,
        profileId: profile.id,
      }),
      context(file.id)
    )
    expect(response.status).toBe(200)
    const outputs = await prisma.file.findMany({
      where: { id: { not: file.id } },
      include: { tags: true },
    })
    expect(
      outputs.every(
        (output) =>
          output.visibility === 'PUBLIC' &&
          output.tags.some((item) => item.tagId === tag.id)
      )
    ).toBe(true)
    expect(
      outputs.every(
        (output) =>
          (output.uploadOptions as { shareStyle: string }).shareStyle ===
          'delivery'
      )
    ).toBe(true)
    const events = await prisma.event.findMany()
    expect(events).toHaveLength(2)
    expect(
      new Set(events.map((event) => event.scheduledAt?.toISOString())).size
    ).toBe(1)
    expect(await prisma.webhookDelivery.count()).toBe(2)
  })
  it('rolls back the entire extraction when cumulative quota is exceeded and queues only staged objects for cleanup', async () => {
    const file = await archive([
      { path: 'one.txt', data: 'x'.repeat(600000) },
      { path: 'two.txt', data: 'y'.repeat(600000) },
    ])
    state.onUpload = async () => {
      state.onUpload = undefined
      await setConfig((config) => {
        config.settings.general.storage.quotas.enabled = true
        config.settings.general.storage.quotas.default = {
          value: 1,
          unit: 'MB',
        }
      })
    }
    const before = (
      await prisma.user.findUniqueOrThrow({ where: { id: 'archive-owner' } })
    ).storageUsed
    expect((await extract(file.id)).status).toBe(413)
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.vaultFolder.count()).toBe(0)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'archive-owner' } }))
        .storageUsed
    ).toBe(before)
    expect(await prisma.storageDeletion.count()).toBe(2)
    expect(await prisma.event.count()).toBe(0)
  })
  it('creates an archive from owned files with unique member names and private defaults', async () => {
    const one = await source('Same.txt', Buffer.from('one'))
    const two = await source('same.txt', Buffer.from('two'))
    const response = await creation.POST(
      request('/api/files/archive', {
        fileIds: [one.id, two.id],
        name: 'Bundle',
        format: 'tar.gz',
        folderId: null,
      })
    )
    expect(response.status).toBe(200)
    const result = (await response.json()).data
    expect(result.file.name).toBe('Bundle.tar.gz')
    const output = await prisma.file.findUniqueOrThrow({
      where: { id: result.file.id },
    })
    expect(output).toMatchObject({ visibility: 'PRIVATE', password: null })
    const listingResponse = await listing.GET(
      request(`/api/files/${output.id}/archive`),
      context(output.id)
    )
    expect(
      (await listingResponse.json()).data.entries.map(
        (entry: { path: string }) => entry.path
      )
    ).toEqual(['Same.txt', 'same (2).txt'])
    expect(await prisma.file.count()).toBe(3)
  })
  it('rejects duplicate wrapper names without overwriting existing folders or publishing files', async () => {
    const file = await archive()
    const folder = await prisma.vaultFolder.create({
      data: {
        userId: 'archive-owner',
        name: 'Extracted',
        normalizedName: 'extracted',
      },
    })
    expect((await extract(file.id)).status).toBe(409)
    expect(await prisma.vaultFolder.findMany()).toEqual([folder])
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.storageDeletion.count()).toBe(2)
  })
  it('preserves safe Unicode labels with usable fallback URLs and portable flattened archive names', async () => {
    const file = await archive([
      { path: '📦', data: 'emoji' },
      { path: '日本語', data: 'unicode' },
      { path: 'notes.md', data: '# Markdown' },
    ])
    expect((await extract(file.id)).status).toBe(200)
    const outputs = await prisma.file.findMany({
      where: { id: { not: file.id } },
    })
    expect(outputs.map((output) => output.name)).toEqual(
      expect.arrayContaining(['📦', '日本語', 'notes.md'])
    )
    expect(
      outputs.every((output) => /\/archive-owner\/[^/]+$/.test(output.urlPath))
    ).toBe(true)
    expect(outputs.find((output) => output.name === 'notes.md')?.mimeType).toBe(
      'text/markdown'
    )
    const windows = await source(
      'C:\\folder\\report:final.txt',
      Buffer.from('windows')
    )
    const fullwidth = await source(
      'folder／report：final.txt',
      Buffer.from('width')
    )
    const response = await creation.POST(
      request('/api/files/archive', {
        fileIds: [windows.id, fullwidth.id],
        name: 'Portable.zip',
        format: 'zip',
        folderId: null,
      })
    )
    expect(response.status).toBe(200)
    const id = (await response.json()).data.file.id
    const listed = await listing.GET(
      request(`/api/files/${id}/archive`),
      context(id)
    )
    expect(
      (await listed.json()).data.entries.map(
        (entry: { path: string }) => entry.path
      )
    ).toEqual(['report-final.txt', 'report-final (2).txt'])
  })
  it('rejects malformed recorded provenance, oversized JSON, and profile ownership violations', async () => {
    const file = await archive()
    await prisma.file.update({
      where: { id: file.id },
      data: { storageTarget: { provider: 's3' } },
    })
    expect(
      (
        await listing.GET(
          request(`/api/files/${file.id}/archive`),
          context(file.id)
        )
      ).status
    ).toBe(409)
    const tooLarge = request('/api/files/archive', { name: 'x'.repeat(17000) })
    expect((await creation.POST(tooLarge)).status).toBe(413)
    const profile = await prisma.uploadProfile.create({
      data: { userId: 'archive-other', name: 'Not yours', options: {} },
    })
    expect(
      (
        await creation.POST(
          request('/api/files/archive', {
            fileIds: [file.id],
            name: 'Output',
            format: 'zip',
            folderId: null,
            profileId: profile.id,
          })
        )
      ).status
    ).toBe(404)
  })
  it('rejects a stale displayed profile revision before any source read or object write', async () => {
    const file = await archive()
    const profile = await prisma.uploadProfile.create({
      data: {
        userId: 'archive-owner',
        name: 'Initially private',
        options: { visibility: 'PRIVATE' },
      },
    })
    await prisma.uploadProfile.update({
      where: { id: profile.id },
      data: {
        options: { visibility: 'PUBLIC' },
        updatedAt: new Date(profile.updatedAt.getTime() + 1000),
      },
    })
    const response = await extraction.POST(
      request(`/api/files/${file.id}/archive/extract`, {
        name: 'Not published',
        folderId: null,
        profileId: profile.id,
        profileRevision: profile.updatedAt.toISOString(),
      }),
      context(file.id)
    )
    expect(response.status).toBe(409)
    expect(state.targets).toHaveLength(0)
    expect(state.objects.size).toBe(1)
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.vaultFolder.count()).toBe(0)
    expect(
      (
        await creation.POST(
          request('/api/files/archive', {
            fileIds: [file.id],
            name: 'Invalid revision',
            format: 'zip',
            folderId: null,
            profileId: null,
            profileRevision: profile.updatedAt.toISOString(),
          })
        )
      ).status
    ).toBe(400)
  })

  async function reviewedProfile(
    options: Prisma.InputJsonObject = { visibility: 'PRIVATE' }
  ) {
    const profile = await prisma.uploadProfile.create({
      data: { userId: 'archive-owner', name: 'Reviewed profile', options },
    })
    const response = await profileListing.GET()
    expect(response.status).toBe(200)
    const data = (await response.json()).data
    const snapshot = data.profiles.find(
      (entry: { id: string }) => entry.id === profile.id
    )
    expect(snapshot.effectiveRevision).toMatch(/^[a-f0-9]{64}$/)
    return { profile, data, snapshot }
  }

  async function changeEffectiveSettings(
    change: 'expiration' | 'action' | 'naming' | 'style' | 'sharing'
  ) {
    if (change === 'expiration')
      await prisma.user.update({
        where: { id: 'archive-owner' },
        data: { defaultFileExpiration: 'HOUR' },
      })
    if (change === 'action')
      await prisma.user.update({
        where: { id: 'archive-owner' },
        data: { defaultFileExpirationAction: 'SET_PRIVATE' },
      })
    if (change === 'naming')
      await prisma.user.update({
        where: { id: 'archive-owner' },
        data: { randomizeFileUrls: true },
      })
    if (change === 'style')
      await setConfig((config) => {
        config.settings.customization.published.sharing.defaultStyle =
          'delivery'
      })
    if (change === 'sharing')
      await prisma.role.update({
        where: { systemKey: 'everyone' },
        data: { permissions: defaultPermissions },
      })
  }

  it.each(['expiration', 'action', 'naming', 'style', 'sharing'] as const)(
    'rejects reviewed effective %s changes before archive creation or extraction reads storage',
    async (change) => {
      const file = await archive()
      if (change === 'sharing')
        await prisma.role.update({
          where: { systemKey: 'everyone' },
          data: {
            permissions: defaultPermissions.filter(
              (permission) => permission !== 'files.share'
            ),
          },
        })
      const { profile, data, snapshot } = await reviewedProfile({
        visibility: 'PUBLIC',
      })
      expect(data.canShare).toBe(change !== 'sharing')
      await changeEffectiveSettings(change)
      state.onRead = vi.fn()
      state.onUpload = vi.fn()
      const selection = {
        profileId: profile.id,
        profileRevision: snapshot.updatedAt,
        profileEffectiveRevision: snapshot.effectiveRevision,
      }
      const created = await creation.POST(
        request('/api/files/archive', {
          fileIds: [file.id],
          name: 'Not published',
          format: 'zip',
          folderId: null,
          ...selection,
        })
      )
      const extracted = await extraction.POST(
        request(`/api/files/${file.id}/archive/extract`, {
          name: 'Not published',
          folderId: null,
          ...selection,
        }),
        context(file.id)
      )
      for (const response of [created, extracted]) {
        expect(response.status).toBe(409)
        expect((await response.json()).error).toContain(
          'effective settings changed'
        )
      }
      expect(state.onRead).not.toHaveBeenCalled()
      expect(state.onUpload).not.toHaveBeenCalled()
      expect(await prisma.file.count()).toBe(1)
      expect(await prisma.event.count()).toBe(0)
      expect(await prisma.vaultFolder.count()).toBe(0)
    }
  )

  it.each(['expiration', 'action', 'naming', 'style', 'sharing'] as const)(
    'rechecks effective %s at publication even when the API caller omitted review revisions',
    async (change) => {
      const file = await archive()
      if (change === 'sharing')
        await prisma.role.update({
          where: { systemKey: 'everyone' },
          data: {
            permissions: defaultPermissions.filter(
              (permission) => permission !== 'files.share'
            ),
          },
        })
      const { profile } = await reviewedProfile({ visibility: 'PUBLIC' })
      state.onUpload = async () => {
        state.onUpload = undefined
        await changeEffectiveSettings(change)
      }
      const response = await extraction.POST(
        request(`/api/files/${file.id}/archive/extract`, {
          name: 'Not published',
          folderId: null,
          profileId: profile.id,
        }),
        context(file.id)
      )
      expect(response.status).toBe(409)
      expect(await prisma.file.count()).toBe(1)
      expect(await prisma.event.count()).toBe(0)
      expect(await prisma.vaultFolder.count()).toBe(0)
      expect(await prisma.storageDeletion.count()).toBe(2)
    }
  )

  it('rechecks inherited expiration at archive creation publication and queues its uncommitted output', async () => {
    const file = await archive()
    const { profile } = await reviewedProfile()
    state.onUpload = async () => {
      state.onUpload = undefined
      await changeEffectiveSettings('expiration')
    }
    const response = await creation.POST(
      request('/api/files/archive', {
        fileIds: [file.id],
        name: 'Not published',
        format: 'zip',
        folderId: null,
        profileId: profile.id,
      })
    )
    expect(response.status).toBe(409)
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.event.count()).toBe(0)
    expect(await prisma.storageDeletion.count()).toBe(1)
  })

  it('keeps the effective revision stable across unrelated account changes and overridden defaults', async () => {
    const file = await archive()
    const { profile, snapshot } = await reviewedProfile({
      visibility: 'PRIVATE',
      expiration: 'DISABLED',
      expiryAction: 'DELETE',
      randomizeFileUrls: false,
      shareStyle: 'minimal',
    })
    await prisma.user.update({
      where: { id: 'archive-owner' },
      data: {
        name: 'Renamed account',
        defaultFileExpiration: 'HOUR',
        defaultFileExpirationAction: 'SET_PRIVATE',
        randomizeFileUrls: true,
      },
    })
    await changeEffectiveSettings('style')
    const data = (await (await profileListing.GET()).json()).data
    const refreshed = data.profiles.find(
      (entry: { id: string }) => entry.id === profile.id
    )
    expect(refreshed.effectiveRevision).toBe(snapshot.effectiveRevision)
    const response = await extraction.POST(
      request(`/api/files/${file.id}/archive/extract`, {
        name: 'Reviewed output',
        folderId: null,
        profileId: profile.id,
        profileRevision: snapshot.updatedAt,
        profileEffectiveRevision: snapshot.effectiveRevision,
      }),
      context(file.id)
    )
    expect(response.status).toBe(200)
    const outputs = await prisma.file.findMany({
      where: { id: { not: file.id } },
    })
    expect(outputs).toHaveLength(2)
    for (const output of outputs) {
      expect(output.visibility).toBe('PRIVATE')
      expect(output.uploadOptions).toMatchObject({
        expiration: 'DISABLED',
        expiresAt: null,
        shareStyle: 'minimal',
        randomizeFileUrls: false,
      })
      expect(output.uploadOptions).not.toHaveProperty(
        'profileEffectiveRevision'
      )
    }
    expect(
      await prisma.event.count({ where: { type: 'file.schedule-expiration' } })
    ).toBe(0)
  })

  it('requires a selected profile for effective revisions and maps a deleted reviewed profile to conflict', async () => {
    const file = await archive()
    const { profile, snapshot } = await reviewedProfile()
    await prisma.uploadProfile.delete({ where: { id: profile.id } })
    for (const profileId of [null, profile.id]) {
      const response = await creation.POST(
        request('/api/files/archive', {
          fileIds: [file.id],
          name: 'Not published',
          format: 'zip',
          folderId: null,
          profileId,
          profileEffectiveRevision: snapshot.effectiveRevision,
        })
      )
      expect(response.status).toBe(profileId ? 409 : 400)
    }
    expect(state.targets).toHaveLength(0)
    expect(await prisma.file.count()).toBe(1)
  })
  it('reports a deleted displayed profile as stale before archive IO while unversioned requests retain 404', async () => {
    const file = await archive()
    const profile = await prisma.uploadProfile.create({
      data: { userId: 'archive-owner', name: 'Removed profile', options: {} },
    })
    await prisma.uploadProfile.delete({ where: { id: profile.id } })
    const input = {
      name: 'Not published',
      folderId: null,
      profileId: profile.id,
    }
    for (const profileRevision of [
      profile.updatedAt.toISOString(),
      undefined,
    ]) {
      const expectedStatus = profileRevision ? 409 : 404
      expect(
        (
          await extraction.POST(
            request(`/api/files/${file.id}/archive/extract`, {
              ...input,
              profileRevision,
            }),
            context(file.id)
          )
        ).status
      ).toBe(expectedStatus)
      expect(
        (
          await creation.POST(
            request('/api/files/archive', {
              ...input,
              profileRevision,
              fileIds: [file.id],
              format: 'zip',
            })
          )
        ).status
      ).toBe(expectedStatus)
    }
    expect(state.targets).toHaveLength(0)
    expect(state.objects.size).toBe(1)
    expect(await prisma.file.count()).toBe(1)
    expect(await prisma.vaultFolder.count()).toBe(0)
  })
  it.each(['role', 'session', 'source'] as const)(
    'rechecks %s after staging before returning archive contents',
    async (change) => {
      const file = await archive()
      state.onRead = async () => {
        state.onRead = undefined
        if (change === 'role')
          await prisma.role.update({
            where: { systemKey: 'everyone' },
            data: { permissions: [] },
          })
        if (change === 'session')
          await prisma.user.update({
            where: { id: 'archive-owner' },
            data: { sessionVersion: { increment: 1 } },
          })
        if (change === 'source')
          await prisma.file.delete({ where: { id: file.id } })
      }
      const response = await listing.GET(
        request(`/api/files/${file.id}/archive`),
        context(file.id)
      )
      expect(response.status).toBe(
        { role: 403, session: 401, source: 409 }[change]
      )
      expect(await prisma.vaultFolder.count()).toBe(0)
    }
  )
  it.each(['role', 'session', 'source', 'destination', 'profile'] as const)(
    'rejects a %s change during output IO before publication',
    async (change) => {
      const file = await archive()
      const destination = await prisma.vaultFolder.create({
        data: {
          userId: 'archive-owner',
          name: 'Destination',
          normalizedName: 'destination',
        },
      })
      const profile = await prisma.uploadProfile.create({
        data: { userId: 'archive-owner', name: 'Profile', options: {} },
      })
      state.onUpload = async () => {
        state.onUpload = undefined
        if (change === 'role')
          await prisma.role.update({
            where: { systemKey: 'everyone' },
            data: { permissions: ['files.read'] },
          })
        if (change === 'session')
          await prisma.user.update({
            where: { id: 'archive-owner' },
            data: { sessionVersion: { increment: 1 } },
          })
        if (change === 'source')
          await prisma.file.delete({ where: { id: file.id } })
        if (change === 'destination')
          await prisma.vaultFolder.delete({ where: { id: destination.id } })
        if (change === 'profile')
          await prisma.uploadProfile.update({
            where: { id: profile.id },
            data: { updatedAt: new Date(Date.now() + 10000) },
          })
      }
      const response = await extraction.POST(
        request(`/api/files/${file.id}/archive/extract`, {
          name: 'New folder',
          folderId: destination.id,
          profileId: profile.id,
        }),
        context(file.id)
      )
      expect(response.status).toBe(
        {
          role: 403,
          session: 401,
          source: 409,
          destination: 404,
          profile: 409,
        }[change]
      )
      expect(await prisma.file.count({ where: { id: { not: file.id } } })).toBe(
        0
      )
      expect(
        await prisma.vaultFolder.count({ where: { name: 'New folder' } })
      ).toBe(0)
      expect(await prisma.storageDeletion.count()).toBe(2)
    }
  )
})
