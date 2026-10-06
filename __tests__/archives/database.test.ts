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
  getAccessSession: async () =>
    state.userId
      ? { user: { id: state.userId, sessionVersion: state.version } }
      : null,
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
    defaultConfig = (await import('@/lib/config')).DEFAULT_CONFIG
    defaultPermissions = [
      ...(await import('@/lib/permissions/catalog')).DEFAULT_PERMISSIONS,
    ]
  })
  beforeEach(async () => {
    state.userId = 'archive-owner'
    state.version = 1
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
