import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const authentication = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () =>
    authentication.user ? { user: authentication.user } : null,
}))

const databaseUrl = process.env.FLARE_CUSTOMIZATION_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('customization contracts against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let config: typeof import('@/lib/config')
  let appearances: typeof import('@/lib/customization/store')
  let profiles: typeof import('@/app/api/upload-profiles/route')
  let profileDefault: typeof import('@/app/api/upload-profiles/default/route')
  let options: typeof import('@/lib/uploads/options')
  let uploads: typeof import('@/lib/uploads/finalize')
  let schema: typeof import('@/lib/uploads/schema')
  let integrations: typeof import('@/app/api/integrations/route')
  let auth: typeof import('@/lib/auth/api-auth')
  let webhooks: typeof import('@/lib/integrations/webhooks')
  let storage: import('@/lib/storage').LocalStorageProvider
  const prefix = `uploads/customization-test-${randomUUID()}`
  const routeRoots = new Set<string>()
  const chunkSessions: { id: string; providerId: string }[] = []

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error('Use an explicitly named disposable local _test database')
    // Regression: upload locks must never acquire a second pooled connection
    // from inside a transaction. Exercise real multipart/part/completion routes
    // with the smallest supported PostgreSQL pool, including concurrent calls.
    url.searchParams.set('connection_limit', '1')
    url.searchParams.set('pool_timeout', '2')
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'flare-public-customization-integration-test-secret'
    )
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', 'true')
    prisma = (await import('@/lib/database/prisma')).prisma
    config = await import('@/lib/config')
    appearances = await import('@/lib/customization/store')
    profiles = await import('@/app/api/upload-profiles/route')
    profileDefault = await import('@/app/api/upload-profiles/default/route')
    options = await import('@/lib/uploads/options')
    uploads = await import('@/lib/uploads/finalize')
    schema = await import('@/lib/uploads/schema')
    integrations = await import('@/app/api/integrations/route')
    auth = await import('@/lib/auth/api-auth')
    webhooks = await import('@/lib/integrations/webhooks')
    storage = new (
      await import('@/lib/storage/providers/local')
    ).LocalStorageProvider()
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    await prisma.event.deleteMany()
    await prisma.config.deleteMany()
    const initial = structuredClone(config.DEFAULT_CONFIG)
    initial.settings.general.ocr.enabled = false
    await prisma.config.create({
      data: { key: 'flare_config', value: initial },
    })
    for (const id of ['owner-one', 'owner-two']) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          urlId: id,
          uploadToken: `${id}-legacy`,
          role: 'USER',
        },
      })
    }
    authentication.user = { id: 'owner-one', role: 'USER' }
  })

  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await prisma?.$disconnect()
    await rm(join(process.cwd(), prefix), { recursive: true, force: true })
    for (const root of routeRoots)
      await rm(join(process.cwd(), root), { recursive: true, force: true })
    for (const session of chunkSessions) {
      await rm(join(process.cwd(), 'tmp/uploads', `meta-${session.id}`), {
        force: true,
      })
      await rm(join(process.cwd(), 'tmp/local-multipart', session.providerId), {
        recursive: true,
        force: true,
      })
    }
    vi.unstubAllEnvs()
  })

  function jsonRequest(path: string, body: unknown, method = 'POST') {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function principal() {
    return await prisma.user.findUniqueOrThrow({ where: { id: 'owner-one' } })
  }

  async function prepared(text = 'A private test document', overrides = {}) {
    const filePath = `${prefix}/${randomUUID()}.txt`
    await storage.uploadFile(Buffer.from(text), filePath, 'text/plain')
    return {
      user: await principal(),
      storage,
      filePath,
      urlPath: `/owner-one/${randomUUID()}.txt`,
      displayName: 'notes.txt',
      mimeType: 'text/plain',
      size: Buffer.byteLength(text),
      options: schema.mergeUploadOptions({}, {}, overrides),
    }
  }

  it('serializes appearance revisions without overwriting unrelated settings', async () => {
    const document = structuredClone(
      config.DEFAULT_CONFIG.settings.customization.published
    )
    document.brand.name = 'Orbit'
    const attempts = await Promise.allSettled([
      appearances.saveAppearance({ action: 'publish', revision: 0, document }),
      appearances.saveAppearance({
        action: 'publish',
        revision: 0,
        document: { ...document, brand: { ...document.brand, name: 'Stale' } },
      }),
    ])
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected')
    ).toHaveLength(1)
    const saved = await config.getConfig()
    expect(saved.settings.customization.revision).toBe(1)
    expect(saved.settings.email).toEqual(config.DEFAULT_CONFIG.settings.email)
  })

  it('keeps profile defaults owned by the user and resolves instance share defaults', async () => {
    await config.updateConfigSection('customization', {
      published: {
        ...config.DEFAULT_CONFIG.settings.customization.published,
        sharing: {
          ...config.DEFAULT_CONFIG.settings.customization.published.sharing,
          defaultStyle: 'minimal',
        },
      },
    })
    const response = await profiles.POST(
      jsonRequest('/api/upload-profiles', {
        name: 'Private work',
        options: {
          visibility: 'PRIVATE',
          expiration: 'DAY',
          expiryAction: 'SET_PRIVATE',
        },
      })
    )
    expect(response.status).toBe(201)
    const profile = (await response.json()).data
    expect(
      (
        await profileDefault.PUT(
          jsonRequest(
            '/api/upload-profiles/default',
            { profileId: profile.id },
            'PUT'
          )
        )
      ).status
    ).toBe(200)
    const resolved = await options.resolveUploadOptions(await principal())
    expect(resolved).toMatchObject({
      profileId: profile.id,
      visibility: 'PRIVATE',
      expiration: 'DAY',
      expiryAction: 'SET_PRIVATE',
      shareStyle: 'minimal',
    })
    authentication.user = { id: 'owner-two', role: 'USER' }
    expect(
      (
        await profileDefault.PUT(
          jsonRequest(
            '/api/upload-profiles/default',
            { profileId: profile.id },
            'PUT'
          )
        )
      ).status
    ).toBe(404)
    expect((await profiles.GET()).status).toBe(200)
    expect((await (await profiles.GET()).json()).data.profiles).toHaveLength(0)
  })

  it('lists, exports and imports old profiles without the retired copy-format option', async () => {
    const profile = await routeFixture('download')
    const listed = await profiles.GET()
    expect(listed.status).toBe(200)
    const listedBody = (await listed.json()).data
    expect(listedBody.profiles[0].options).not.toHaveProperty('copyFormat')
    expect(listedBody.effective).not.toHaveProperty('copyFormat')
    const exporter = await import('@/app/api/upload-profiles/[id]/export/route')
    const exported = await exporter.GET(
      new Request(`http://localhost/api/upload-profiles/${profile.id}/export`),
      { params: Promise.resolve({ id: profile.id }) }
    )
    expect(exported.status).toBe(200)
    const recipe = await exported.json()
    expect(recipe.profile.options).not.toHaveProperty('copyFormat')
    const imported = await profiles.POST(
      jsonRequest('/api/upload-profiles', {
        ...recipe,
        profile: {
          ...recipe.profile,
          name: 'Imported old recipe',
          options: { ...recipe.profile.options, copyFormat: 'raw' },
        },
      })
    )
    expect(imported.status).toBe(201)
    const saved = (await imported.json()).data
    expect(saved.options).toEqual(recipe.profile.options)
    expect(
      (
        await prisma.uploadProfile.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).options
    ).not.toHaveProperty('copyFormat')
  })

  it('commits the file, expiry action, quota and webhook once when finalization is retried', async () => {
    const created = await integrations.POST(
      jsonRequest('/api/integrations', {
        action: 'create-webhook',
        name: 'Local fixture',
        url: 'http://127.0.0.1:39999/events',
      })
    )
    expect(created.status).toBe(200)
    const hook = await created.json()
    const input = await prepared('Private notes', {
      visibility: 'PRIVATE',
      expiration: 'DAY',
      expiryAction: 'SET_PRIVATE',
      password: 'test-password',
    })
    const first = await uploads.finalizeUpload(input)
    const repeated = await uploads.finalizeUpload(input)
    expect(repeated.id).toBe(first.id)
    expect(await prisma.file.count()).toBe(1)
    expect((await principal()).storageUsed).toBe(input.size / 1024 ** 2)
    expect(first.password).not.toBe('test-password')
    expect(JSON.stringify(first.uploadOptions)).not.toContain('test-password')
    const expiry = await prisma.event.findFirstOrThrow()
    expect(expiry.payload).toMatchObject({
      fileId: first.id,
      action: 'SET_PRIVATE',
    })
    const deliveries = await prisma.webhookDelivery.findMany()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({
      webhookId: hook.webhook.id,
      eventId: `file.ready:${first.id}`,
      status: 'pending',
    })
    expect(JSON.stringify(deliveries[0].payload)).not.toContain('test-password')
    expect(JSON.stringify(deliveries[0].payload)).not.toContain(input.filePath)
  })

  it('resolves concurrent quota admission against committed usage', async () => {
    const general = structuredClone(config.DEFAULT_CONFIG.settings.general)
    general.storage.quotas = {
      enabled: true,
      default: { value: 1, unit: 'MB' },
    }
    await config.updateConfigSection('general', general)
    const first = await prepared('a'.repeat(700_000))
    const second = await prepared('b'.repeat(700_000))
    const attempts = await Promise.allSettled([
      uploads.finalizeUpload(first),
      uploads.finalizeUpload(second),
    ])
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled')
    ).toHaveLength(1)
    expect(await prisma.file.count()).toBe(1)
    expect((await principal()).storageUsed).toBe(700_000 / 1024 ** 2)
  })

  it('changes public URLs without moving stored files and publishes in-flight uploads under the new ID', async () => {
    const input = await prepared('Existing file')
    const first = await uploads.finalizeUpload(input)
    const inFlight = await prepared('Upload started before the ID change')
    // Reuse the filename to exercise collision handling after the ID changes.
    inFlight.urlPath = first.urlPath
    await prisma.user.update({
      where: { id: 'owner-one' },
      data: {
        role: 'ADMIN',
        email: 'owner@example.test',
        vanityId: 'owner-alias',
      },
    })
    authentication.user = { id: 'owner-one', role: 'ADMIN' }
    const users = await import('@/app/api/users/route')
    const response = await users.PUT(
      jsonRequest(
        '/api/users',
        {
          id: 'owner-one',
          name: 'Owner',
          email: 'owner@example.test',
          role: 'ADMIN',
          urlId: 'SPECC',
        },
        'PUT'
      )
    )
    expect(response.status).toBe(200)
    const saved = await prisma.file.findUniqueOrThrow({
      where: { id: first.id },
    })
    expect(saved.path).toBe(input.filePath)
    expect(saved.urlPath).toBe(first.urlPath.replace('/owner-one/', '/SPECC/'))
    expect((await principal()).urlId).toBe('SPECC')
    const { resolveFileUrlPath } = await import('@/lib/files/resolve')
    expect(
      await resolveFileUrlPath('SPECC', saved.urlPath.split('/').pop()!)
    ).toBe(saved.urlPath)
    expect(
      await resolveFileUrlPath('owner-alias', saved.urlPath.split('/').pop()!)
    ).toBe(saved.urlPath)
    const stream = await storage.getFileStream(saved.path)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('Existing file')

    const late = await uploads.finalizeUpload(inFlight)
    expect(late.path).toBe(inFlight.filePath)
    expect(late.urlPath).toMatch(/^\/SPECC\/.*-[a-z0-9-]{12}\.txt$/)
    expect(late.urlPath).not.toBe(saved.urlPath)
    expect(await storage.getFileSize(late.path)).toBe(inFlight.size)
    // Chunk completion can reauthenticate after the change while retaining old metadata.
    const lateWithFreshUser = await uploads.finalizeUpload({
      ...(await prepared('Upload completed with refreshed credentials')),
      urlPath: '/owner-one/fresh-credentials.txt',
    })
    expect(lateWithFreshUser.urlPath).toBe('/SPECC/fresh-credentials.txt')
  })

  it('rolls back all public URL changes if the account update fails', async () => {
    const first = await uploads.finalizeUpload(await prepared('First file'))
    const second = await uploads.finalizeUpload(await prepared('Second file'))
    await prisma.user.update({
      where: { id: 'owner-one' },
      data: { role: 'ADMIN', email: 'owner@example.test' },
    })
    await prisma.user.update({
      where: { id: 'owner-two' },
      data: { email: 'taken@example.test' },
    })
    authentication.user = { id: 'owner-one', role: 'ADMIN' }
    const users = await import('@/app/api/users/route')
    const response = await users.PUT(
      jsonRequest(
        '/api/users',
        {
          id: 'owner-one',
          name: 'Owner',
          email: 'taken@example.test',
          role: 'ADMIN',
          urlId: 'SPECC',
        },
        'PUT'
      )
    )
    expect(response.status).toBe(500)
    expect((await principal()).urlId).toBe('owner-one')
    for (const file of [first, second]) {
      const saved = await prisma.file.findUniqueOrThrow({
        where: { id: file.id },
      })
      expect(saved.urlPath).toBe(file.urlPath)
      expect(saved.path).toBe(file.path)
      expect(await storage.getFileSize(saved.path)).toBeGreaterThan(0)
    }
  })

  it('rolls back file and accounting if transactional webhook enqueue fails', async () => {
    const input = await prepared()
    vi.spyOn(webhooks, 'enqueueFileReady').mockRejectedValueOnce(
      new Error('Unavailable outbox')
    )
    await expect(uploads.finalizeUpload(input)).rejects.toThrow(
      'Unavailable outbox'
    )
    expect(await prisma.file.count()).toBe(0)
    expect((await principal()).storageUsed).toBe(0)
    await uploads.cleanupUncommittedUpload(storage, input.filePath)
    await expect(storage.getFileSize(input.filePath)).rejects.toThrow()
  })

  it('enforces scoped tokens, profile binding, revocation and session-only management', async () => {
    const profile = await prisma.uploadProfile.create({
      data: {
        userId: 'owner-one',
        name: 'Bound',
        options: { visibility: 'PRIVATE', expiration: 'DAY' },
      },
    })
    const result = await integrations.POST(
      jsonRequest('/api/integrations', {
        action: 'create-token',
        name: 'Screenshot client',
        scopes: ['files:upload'],
        profileId: profile.id,
      })
    )
    expect(result.status).toBe(200)
    const created = await result.json()
    const row = await prisma.apiToken.findUniqueOrThrow({
      where: { id: created.token.id },
    })
    expect(row.hash).not.toBe(created.secret)
    authentication.user = null
    const tokenRequest = (path: string, method = 'GET') =>
      new Request(`http://localhost${path}`, {
        method,
        headers: { Authorization: `Bearer ${created.secret}` },
      })
    const user = await auth.getAuthenticatedUser(
      tokenRequest('/api/files', 'POST')
    )
    expect(user?.apiToken?.profileId).toBe(profile.id)
    expect(
      await auth.getAuthenticatedUser(tokenRequest('/api/files'))
    ).toBeNull()
    expect(
      await auth.getAuthenticatedUser(tokenRequest('/api/profile/upload-token'))
    ).toBeNull()
    expect((await integrations.GET()).status).toBe(401)
    expect((await options.resolveUploadOptions(user!)).visibility).toBe(
      'PRIVATE'
    )
    await expect(
      options.resolveUploadOptions(user!, { visibility: 'PUBLIC' })
    ).rejects.toThrow()
    await prisma.apiToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    })
    expect(
      await auth.getAuthenticatedUser(tokenRequest('/api/files', 'POST'))
    ).toBeNull()
  })

  it('claims deliveries once across workers and recovers an expired lease', async () => {
    const result = await integrations.POST(
      jsonRequest('/api/integrations', {
        action: 'create-webhook',
        name: 'Fixture',
        url: 'http://127.0.0.1:39999/events',
      })
    )
    const hook = (await result.json()).webhook
    for (let i = 0; i < 6; i++)
      await integrations.POST(
        jsonRequest('/api/integrations', {
          action: 'test-webhook',
          id: hook.id,
        })
      )
    const batches = await Promise.all([
      webhooks.claimWebhookDeliveries(),
      webhooks.claimWebhookDeliveries(),
    ])
    const claimed = batches.flat()
    expect(claimed).toHaveLength(4)
    expect(new Set(claimed.map((item) => item.id)).size).toBe(4)
    await prisma.webhookDelivery.update({
      where: { id: claimed[0].id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    })
    const recovered = await webhooks.claimWebhookDeliveries()
    expect(recovered).toHaveLength(1)
    expect(recovered[0].id).toBe(claimed[0].id)
    expect(recovered[0].attempts).toBe(2)
  })

  async function routeFixture(copyFormat = 'markdown') {
    const urlId = `customization-routes-${randomUUID()}`
    routeRoots.add(`uploads/${urlId}`)
    const profile = await prisma.uploadProfile.create({
      data: {
        userId: 'owner-one',
        name: 'Screenshot defaults',
        options: {
          visibility: 'PRIVATE',
          expiration: 'DAY',
          expiryAction: 'SET_PRIVATE',
          randomizeFileUrls: true,
          shareStyle: 'minimal',
          copyFormat,
        },
      },
    })
    await prisma.user.update({
      where: { id: 'owner-one' },
      data: { defaultUploadProfileId: profile.id, urlId },
    })
    return profile
  }

  async function startChunk(text: string, overrides = {}) {
    const routes = await import('@/app/api/files/chunks/route')
    const helper = await import('@/lib/uploads/chunks')
    const response = await routes.POST(
      jsonRequest('/api/files/chunks', {
        filename: 'capture.txt',
        mimeType: 'text/plain',
        size: Buffer.byteLength(text),
        password: 'upload-password',
        ...overrides,
      })
    )
    expect(response.status).toBe(200)
    const data = (await response.json()).data
    const metadata = await helper.getUploadMetadata(data.uploadId)
    expect(metadata).not.toBeNull()
    chunkSessions.push({ id: data.uploadId, providerId: metadata!.s3UploadId })
    expect(JSON.stringify(metadata)).not.toContain('upload-password')
    return { data, metadata: metadata! }
  }

  it.each(['markdown', 'html', 'raw', 'download'])(
    'uses share-page links for legacy %s profiles through multipart and both chunk completion APIs',
    async (copyFormat) => {
      const profile = await routeFixture(copyFormat)
      await integrations.POST(
        jsonRequest('/api/integrations', {
          action: 'create-webhook',
          name: 'Upload parity fixture',
          url: 'http://127.0.0.1:39999/events',
        })
      )
      const fileRoutes = await import('@/app/api/files/route')
      const chunkRoutes = await import('@/app/api/files/chunks/route')
      const partRoutes =
        await import('@/app/api/files/chunks/[uploadId]/part/[partNumber]/route')
      const completion =
        await import('@/app/api/files/chunks/[uploadId]/complete/route')
      const text = 'An actual multipart and chunked file payload.'
      const form = new FormData()
      form.append(
        'file',
        new Blob([text], { type: 'text/plain' }),
        'capture.txt'
      )
      form.append('password', 'upload-password')
      form.append('copyFormat', copyFormat)
      const direct = await fileRoutes.POST(
        new Request('http://localhost/api/files', {
          method: 'POST',
          body: form,
        })
      )
      expect(direct.status).toBe(200)
      const directBody = (await direct.json()).data
      expect(directBody.url).toBe(directBody.pageUrl)
      expect(directBody.copyText).toBe(directBody.pageUrl)
      expect(directBody.url).not.toContain('/api/files/')

      const buffered = await startChunk(text, { copyFormat })
      const partResponse = await partRoutes.PUT(
        new Request(
          `http://localhost/api/files/chunks/${buffered.data.uploadId}/part/1`,
          { method: 'PUT', body: text }
        ),
        {
          params: Promise.resolve({
            uploadId: buffered.data.uploadId,
            partNumber: '1',
          }),
        }
      )
      expect(partResponse.status).toBe(200)
      const parts = [
        { ETag: (await partResponse.json()).data.etag, PartNumber: 1 },
      ]
      const finish = () =>
        completion.POST(
          jsonRequest(`/api/files/chunks/${buffered.data.uploadId}/complete`, {
            parts,
            copyFormat,
          }),
          { params: Promise.resolve({ uploadId: buffered.data.uploadId }) }
        )
      const first = await finish()
      expect(first.status).toBe(200)
      const firstBody = await first.json()
      expect(firstBody.url).toBe(firstBody.pageUrl)
      expect(firstBody.copyText).toBe(firstBody.pageUrl)
      expect(firstBody.url).not.toContain('/api/files/')
      const retry = await finish()
      expect(retry.status).toBe(200)
      expect((await retry.json()).url).toBe(firstBody.url)

      const providerDirect = await startChunk(text, { copyFormat })
      const providerPart = await storage.uploadPart(
        providerDirect.metadata.fileKey,
        providerDirect.metadata.s3UploadId,
        1,
        Buffer.from(text)
      )
      const providerResponse = await chunkRoutes.PUT(
        jsonRequest(
          '/api/files/chunks',
          {
            uploadId: providerDirect.data.uploadId,
            copyFormat,
            parts: [{ ETag: providerPart.ETag, PartNumber: 1 }],
          },
          'PUT'
        )
      )
      expect(providerResponse.status).toBe(200)
      const providerBody = (await providerResponse.json()).data
      expect(providerBody.url).toBe(providerBody.pageUrl)
      expect(providerBody.copyText).toBe(providerBody.pageUrl)
      expect(providerBody.url).not.toContain('/api/files/')
      const files = await prisma.file.findMany()
      expect(files).toHaveLength(3)
      const { compare } = await import('bcryptjs')
      for (const file of files) {
        expect(file.visibility).toBe('PRIVATE')
        expect(await compare('upload-password', file.password!)).toBe(true)
        expect(file.uploadOptions).toMatchObject({
          profileId: profile.id,
          expiration: 'DAY',
          expiryAction: 'SET_PRIVATE',
          shareStyle: 'minimal',
          randomizeFileUrls: true,
        })
        expect(file.uploadOptions).not.toHaveProperty('copyFormat')
        expect(file.urlPath).not.toMatch(/\/capture\.txt$/)
        const event = await prisma.event.findFirstOrThrow({
          where: { payload: { path: ['fileId'], equals: file.id } },
        })
        expect(event.payload).toMatchObject({ action: 'SET_PRIVATE' })
        expect(
          event.scheduledAt!.getTime() - file.uploadedAt.getTime()
        ).toBeGreaterThan(86_390_000)
        expect(await storage.getFileSize(file.path)).toBe(
          Buffer.byteLength(text)
        )
      }
      expect(await prisma.webhookDelivery.count()).toBe(3)
      expect((await principal()).storageUsed).toBeCloseTo(
        (3 * Buffer.byteLength(text)) / 1024 ** 2,
        12
      )
    }
  )

  it('pins in-progress chunk profiles and makes simultaneous completion idempotent', async () => {
    const profile = await routeFixture()
    const text = 'Snapshot retained after a profile edit.'
    const { data, metadata } = await startChunk(text)
    const part = await storage.uploadPart(
      metadata.fileKey,
      metadata.s3UploadId,
      1,
      Buffer.from(text)
    )
    await prisma.uploadProfile.update({
      where: { id: profile.id },
      data: {
        options: {
          visibility: 'PUBLIC',
          expiration: 'DISABLED',
          copyFormat: 'raw',
        },
      },
    })
    const completion =
      await import('@/app/api/files/chunks/[uploadId]/complete/route')
    const request = () =>
      completion.POST(
        jsonRequest(`/api/files/chunks/${data.uploadId}/complete`, {
          parts: [{ ETag: part.ETag, PartNumber: 1 }],
        }),
        { params: Promise.resolve({ uploadId: data.uploadId }) }
      )
    const responses = await Promise.all([request(), request()])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    )
    expect(bodies[0].url).toBe(bodies[1].url)
    expect(await prisma.file.count()).toBe(1)
    expect((await prisma.file.findFirstOrThrow()).uploadOptions).toMatchObject({
      visibility: 'PRIVATE',
      expiration: 'DAY',
    })
    expect((await principal()).storageUsed).toBe(
      Buffer.byteLength(text) / 1024 ** 2
    )
  })

  it('rejects concurrent multipart quota overflow and removes only the uncommitted object', async () => {
    await routeFixture()
    const general = structuredClone(config.DEFAULT_CONFIG.settings.general)
    general.storage.quotas = {
      enabled: true,
      default: { value: 1, unit: 'MB' },
    }
    await config.updateConfigSection('general', general)
    const routes = await import('@/app/api/files/route')
    const upload = (character: string) => {
      const form = new FormData()
      form.append(
        'file',
        new Blob([character.repeat(700_000)], { type: 'text/plain' }),
        'same-name.txt'
      )
      return routes.POST(
        new Request('http://localhost/api/files', {
          method: 'POST',
          body: form,
        })
      )
    }
    const responses = await Promise.all([upload('a'), upload('b')])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 413,
    ])
    const files = await prisma.file.findMany()
    expect(files).toHaveLength(1)
    expect(await storage.getFileSize(files[0].path)).toBe(700_000)
    expect((await principal()).storageUsed).toBe(700_000 / 1024 ** 2)
  })

  it('denies a bound token access to another profile’s chunks before any bytes can be changed', async () => {
    await routeFixture()
    const { data } = await startChunk('A protected chunk')
    const bound = await prisma.uploadProfile.create({
      data: {
        userId: 'owner-one',
        name: 'Other profile',
        options: { visibility: 'PRIVATE' },
      },
    })
    const tokenResponse = await integrations.POST(
      jsonRequest('/api/integrations', {
        action: 'create-token',
        name: 'Bound chunk client',
        scopes: ['files:upload'],
        profileId: bound.id,
      })
    )
    const token = await tokenResponse.json()
    authentication.user = null
    const parts =
      await import('@/app/api/files/chunks/[uploadId]/part/[partNumber]/route')
    const response = await parts.PUT(
      new Request(`http://localhost/api/files/chunks/${data.uploadId}/part/1`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token.secret}` },
        body: 'tampered',
      }),
      { params: Promise.resolve({ uploadId: data.uploadId, partNumber: '1' }) }
    )
    expect(response.status).toBe(403)
    expect(await prisma.file.count()).toBe(0)
  })

  it('redacts password hashes from scoped file listings and owner updates', async () => {
    const file = await uploads.finalizeUpload(
      await prepared('Protected notes', { password: 'private-password' })
    )
    const created = await integrations.POST(
      jsonRequest('/api/integrations', {
        action: 'create-token',
        name: 'Read metadata',
        scopes: ['files:read'],
      })
    )
    const token = await created.json()
    authentication.user = null
    const routes = await import('@/app/api/files/route')
    const response = await routes.GET(
      new Request('http://localhost/api/files', {
        headers: { Authorization: `Bearer ${token.secret}` },
      })
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain(file.password!)
    expect(body).not.toContain('"password"')
    expect(body).toContain('"hasPassword":true')

    authentication.user = { id: 'owner-one', role: 'USER' }
    const updates = await import('@/app/api/files/[id]/route')
    for (const changes of [
      { password: 'replacement-password' },
      { visibility: 'PRIVATE' },
      { password: null },
    ]) {
      const updated = await updates.PATCH(
        jsonRequest(`/api/files/${file.id}`, changes, 'PATCH'),
        { params: Promise.resolve({ id: file.id }) }
      )
      expect(updated.status).toBe(200)
      const metadata = await updated.json()
      const persisted = await prisma.file.findUniqueOrThrow({
        where: { id: file.id },
      })
      expect(metadata).not.toHaveProperty('password')
      expect(metadata.hasPassword).toBe(Boolean(persisted.password))
      expect(metadata.visibility).toBe(persisted.visibility)
      expect(JSON.stringify(metadata)).not.toContain('replacement-password')
      if (persisted.password) {
        expect(JSON.stringify(metadata)).not.toContain(persisted.password)
        expect(
          await (
            await import('bcryptjs')
          ).compare('replacement-password', persisted.password)
        ).toBe(true)
      }
    }
  })

  it('serves restricted thumbnails only with access and keeps their bytes and denials out of shared caches', async () => {
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    )
    const thumbnails = await import('@/app/api/files/[id]/thumbnail/route')
    for (const variant of [
      { visibility: 'PRIVATE' as const, password: null, deniedStatus: 404 },
      {
        visibility: 'PUBLIC' as const,
        password: 'thumbnail-password',
        deniedStatus: 401,
      },
      { visibility: 'PUBLIC' as const, password: null, deniedStatus: null },
    ]) {
      authentication.user = { id: 'owner-one', role: 'USER' }
      const filePath = `${prefix}/${randomUUID()}.png`
      await storage.uploadFile(image, filePath, 'image/png')
      const file = await uploads.finalizeUpload({
        user: await principal(),
        storage,
        filePath,
        urlPath: `/owner-one/${randomUUID()}.png`,
        displayName: 'screenshot.png',
        mimeType: 'image/png',
        size: image.length,
        options: schema.mergeUploadOptions({}, {}, variant),
      })
      const requestThumbnail = (password?: string) =>
        thumbnails.GET(
          new Request(
            `http://localhost/api/files/${file.id}/thumbnail${password ? `?password=${password}` : ''}`
          ),
          { params: Promise.resolve({ id: file.id }) }
        )
      const ownerResponse = await requestThumbnail()
      expect(ownerResponse.status).toBe(200)
      expect(ownerResponse.headers.get('Content-Type')).toBe('image/png')
      const expectedCache = variant.deniedStatus
        ? 'private, no-store'
        : 'public, max-age=31536000, immutable'
      expect(ownerResponse.headers.get('Cache-Control')).toBe(expectedCache)
      expect(Buffer.from(await ownerResponse.arrayBuffer())).toEqual(image)

      authentication.user = null
      const anonymousResponse = await requestThumbnail()
      expect(anonymousResponse.status).toBe(variant.deniedStatus ?? 200)
      expect(anonymousResponse.headers.get('Cache-Control')).toBe(expectedCache)
      expect(Buffer.from(await anonymousResponse.arrayBuffer())).toEqual(
        variant.deniedStatus ? Buffer.alloc(0) : image
      )
      if (variant.password) {
        const passwordResponse = await requestThumbnail(variant.password)
        expect(passwordResponse.status).toBe(200)
        expect(passwordResponse.headers.get('Cache-Control')).toBe(
          'private, no-store'
        )
        expect(Buffer.from(await passwordResponse.arrayBuffer())).toEqual(image)
      }
    }
  })

  it('rejects cross-origin and non-JSON profile mutations without changing saved profiles', async () => {
    const crossOrigin = new Request('http://localhost/api/upload-profiles', {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Unwanted', options: {} }),
    })
    expect((await profiles.POST(crossOrigin)).status).toBe(403)
    const wrongType = new Request('http://localhost/api/upload-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'Unwanted', options: {} }),
    })
    expect((await profiles.POST(wrongType)).status).toBe(415)
    expect(await prisma.uploadProfile.count()).toBe(0)
  })

  it('applies expiry actions once and honors a cancellation racing a queued worker', async () => {
    const expiry = await import('@/lib/events/handlers/file-expiry')
    const { events } = await import('@/lib/events')
    await expiry.registerFileExpiryHandlers()
    const makeDue = async (
      file: Awaited<ReturnType<typeof uploads.finalizeUpload>>
    ) => {
      const event = await prisma.event.findFirstOrThrow({
        where: { payload: { path: ['fileId'], equals: file.id } },
      })
      const due = new Date(Date.now() - 1000)
      await prisma.event.update({
        where: { id: event.id },
        data: { scheduledAt: due },
      })
      await prisma.file.update({
        where: { id: file.id },
        data: {
          uploadOptions: {
            ...(file.uploadOptions as Record<string, string>),
            expiresAt: due.toISOString(),
          },
        },
      })
      return event.id
    }
    const privateFile = await uploads.finalizeUpload(
      await prepared('Make me private', {
        expiration: 'DAY',
        expiryAction: 'SET_PRIVATE',
      })
    )
    const privateEvent = await makeDue(privateFile)
    expect(
      (await events.processEvent((await events.getEvent(privateEvent))!))
        .success
    ).toBe(true)
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: privateFile.id } }))
        .visibility
    ).toBe('PRIVATE')
    await prisma.file.update({
      where: { id: privateFile.id },
      data: { visibility: 'PUBLIC' },
    })
    // A delayed duplicate must not undo the owner's later explicit change.
    expect(
      (await events.processEvent((await events.getEvent(privateEvent))!))
        .success
    ).toBe(true)
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: privateFile.id } }))
        .visibility
    ).toBe('PUBLIC')
    const deleteFile = await uploads.finalizeUpload(
      await prepared('Delete me', { expiration: 'DAY', expiryAction: 'DELETE' })
    )
    const deleteEvent = await makeDue(deleteFile)
    ;(await import('@/lib/storage')).invalidateStorageProvider()
    expect(
      (await events.processEvent((await events.getEvent(deleteEvent))!)).success
    ).toBe(true)
    expect(
      (await events.processEvent((await events.getEvent(deleteEvent))!)).success
    ).toBe(true)
    expect(
      await prisma.file.findUnique({ where: { id: deleteFile.id } })
    ).toBeNull()
    expect((await principal()).storageUsed).toBeCloseTo(privateFile.size, 12)
    const retained = await uploads.finalizeUpload(
      await prepared('Keep me', { expiration: 'DAY', expiryAction: 'DELETE' })
    )
    const pending = await prisma.event.findFirstOrThrow({
      where: { payload: { path: ['fileId'], equals: retained.id } },
    })
    await prisma.event.update({
      where: { id: pending.id },
      data: { status: 'PROCESSING' },
    })
    const stale = (await events.getEvent(pending.id))!
    expect(await expiry.cancelFileExpiration(retained.id)).toBe(true)
    expect((await events.processEvent(stale)).success).toBe(true)
    expect(
      await prisma.file.findUnique({ where: { id: retained.id } })
    ).not.toBeNull()
    expect(await expiry.getFileExpirationInfo(retained.id)).toBeNull()
  })

  it('rejects traversal and malformed IDs for metadata reads and writes without changing a valid session', async () => {
    await routeFixture()
    const { data, metadata } = await startChunk('Retain this upload session')
    const chunks = await import('@/lib/uploads/chunks')
    for (const id of [
      '../escape',
      'a/../../escape',
      'a\\..\\escape',
      '/tmp/escape',
      'a%2fescape',
      'a\u0000b',
      '',
      'a'.repeat(101),
    ]) {
      await expect(chunks.getUploadMetadata(id)).rejects.toMatchObject({
        status: 400,
      })
      await expect(
        chunks.saveUploadMetadata(id, metadata)
      ).rejects.toMatchObject({ status: 400 })
    }
    expect(await chunks.getUploadMetadata(data.uploadId)).toEqual(metadata)
  })
})
