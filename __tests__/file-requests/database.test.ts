import { randomUUID } from 'node:crypto'
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
  userId: 'owner' as string | null,
  objects: new Map<string, Buffer>(),
  multipart: new Map<string, { path: string; parts: Map<number, Buffer> }>(),
  aborted: new Set<string>(),
  onInit: undefined as undefined | (() => Promise<void>),
  onPart: undefined as undefined | (() => Promise<void>),
  onComplete: undefined as undefined | (() => Promise<void>),
  failAbort: 0,
  ocr: vi.fn(),
}))
// Sessions resolve permissions from the database, matching the real session callback.
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => {
    if (!state.userId) return null
    const { getUserAccess } = await import('@/lib/permissions/server')
    return {
      user: { id: state.userId, ...(await getUserAccess(state.userId)) },
    }
  },
}))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: state.ocr } }))
vi.mock('@/lib/security/rate-limit', async (original) => ({
  ...(await original<typeof import('@/lib/security/rate-limit')>()),
  rateLimit: async () => null,
}))
vi.mock('@/lib/storage', () => ({ getStorageProvider: async () => storage }))

const storage = {
  kind: 'local' as const,
  target: { provider: 'local' as const },
  async initializeMultipartUpload(path: string) {
    await state.onInit?.()
    const id = randomUUID()
    state.multipart.set(id, { path, parts: new Map() })
    return id
  },
  async uploadPart(
    path: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ) {
    await state.onPart?.()
    // Like the local provider, writing a part recreates a removed upload.
    let upload = state.multipart.get(uploadId)
    if (!upload) {
      upload = { path, parts: new Map() }
      state.multipart.set(uploadId, upload)
    }
    upload.parts.set(partNumber, Buffer.from(data))
    return { ETag: `"etag-${partNumber}"`, PartNumber: partNumber }
  },
  async completeMultipartUpload(
    path: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[]
  ) {
    await state.onComplete?.()
    const upload = state.multipart.get(uploadId)
    if (!upload || upload.path !== path) throw new Error('NoSuchUpload')
    state.objects.set(
      path,
      Buffer.concat(parts.map((part) => upload.parts.get(part.PartNumber)!))
    )
    state.multipart.delete(uploadId)
  },
  async getFileSize(path: string) {
    const bytes = state.objects.get(path)
    if (!bytes) throw new Error('Missing fixture object')
    return bytes.length
  },
  async getFileStream(path: string, range?: { start?: number; end?: number }) {
    const bytes = state.objects.get(path)
    if (!bytes) throw new Error('Missing fixture object')
    return Readable.from([
      range
        ? bytes.subarray(range.start ?? 0, (range.end ?? bytes.length) + 1)
        : bytes,
    ])
  },
  async deleteFile(path: string) {
    state.objects.delete(path)
  },
  async abortMultipartUpload(_path: string, uploadId: string) {
    if (state.failAbort > 0) {
      state.failAbort--
      throw new Error('Storage unavailable')
    }
    state.multipart.delete(uploadId)
    state.aborted.add(uploadId)
  },
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const text = (value: string) => Buffer.from(value)

const databaseUrl = process.env.FLARE_FILE_REQUESTS_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('file requests against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let permissions: typeof import('@/lib/permissions/server')
  let service: typeof import('@/lib/file-requests/service')
  let notify: typeof import('@/lib/file-requests/notify')
  let collection: typeof import('@/app/api/file-requests/route')
  let detail: typeof import('@/app/api/file-requests/[id]/route')
  let submissions: typeof import('@/app/api/r/[token]/submissions/route')
  let finishRoute: typeof import('@/app/api/r/[token]/submissions/[id]/complete/route')
  let uploads: typeof import('@/app/api/r/[token]/uploads/route')
  let parts: typeof import('@/app/api/r/[token]/uploads/[uploadId]/parts/[partNumber]/route')
  let completion: typeof import('@/app/api/r/[token]/uploads/[uploadId]/complete/route')
  let cancellation: typeof import('@/app/api/r/[token]/uploads/[uploadId]/route')
  let settings: typeof import('@/app/api/settings/file-requests/route')
  let ownerParts: typeof import('@/app/api/files/chunks/[uploadId]/part/[partNumber]/route')
  let DEFAULT_CONFIG: typeof import('@/lib/config').DEFAULT_CONFIG
  let builtins: { everyone: { id: string }; administrator: { id: string } }

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/^\/flare_file_requests_test_/.test(url.pathname)
    )
      throw new Error(
        'Use a disposable local flare_file_requests_test_ database'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv('NEXTAUTH_SECRET', 'file-request-tests-only-'.padEnd(48, 'x'))
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost')
    prisma = (await import('@/lib/database/prisma')).prisma
    DEFAULT_CONFIG = (await import('@/lib/config')).DEFAULT_CONFIG
    permissions = await import('@/lib/permissions/server')
    service = await import('@/lib/file-requests/service')
    notify = await import('@/lib/file-requests/notify')
    collection = await import('@/app/api/file-requests/route')
    detail = await import('@/app/api/file-requests/[id]/route')
    submissions = await import('@/app/api/r/[token]/submissions/route')
    finishRoute =
      await import('@/app/api/r/[token]/submissions/[id]/complete/route')
    uploads = await import('@/app/api/r/[token]/uploads/route')
    parts =
      await import('@/app/api/r/[token]/uploads/[uploadId]/parts/[partNumber]/route')
    completion =
      await import('@/app/api/r/[token]/uploads/[uploadId]/complete/route')
    cancellation = await import('@/app/api/r/[token]/uploads/[uploadId]/route')
    settings = await import('@/app/api/settings/file-requests/route')
    ownerParts =
      await import('@/app/api/files/chunks/[uploadId]/part/[partNumber]/route')
  })

  async function saveConfig(
    change: (config: typeof DEFAULT_CONFIG) => void = () => {}
  ) {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.setup = { completed: true, completedAt: new Date() }
    config.settings.general.ocr = { enabled: false }
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

  beforeEach(async () => {
    state.objects.clear()
    state.multipart.clear()
    state.aborted.clear()
    state.onInit = undefined
    state.onPart = undefined
    state.onComplete = undefined
    state.failAbort = 0
    state.ocr.mockReset()
    state.ocr.mockResolvedValue(undefined)
    await prisma.auditEvent.deleteMany()
    await prisma.mailOutbox.deleteMany()
    await prisma.emailRateLimit.deleteMany()
    await prisma.event.deleteMany()
    await prisma.fileRequest.deleteMany()
    await prisma.user.deleteMany()
    await prisma.role.deleteMany()
    await prisma.config.deleteMany()
    await saveConfig()
    builtins = await prisma.$transaction(permissions.ensureBuiltInRoles)
    // Fresh and upgraded instances alike: Everyone does not request files.
    const everyone = await prisma.role.findUniqueOrThrow({
      where: { systemKey: 'everyone' },
    })
    expect(everyone.permissions).not.toContain('fileRequests.manage')
    await account('owner', 'Alex Owner', [builtins.administrator.id])
    await account('member', 'Morgan Member')
    state.userId = 'owner'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  async function account(id: string, name: string, roleIds: string[] = []) {
    return prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        emailVerified: new Date(),
        emailVerifiedFor: `${id}@example.test`,
        emailVerificationSource: 'email',
        password: 'fixture-only',
        urlId: id.slice(0, 5).padEnd(5, '0'),
        uploadToken: `${id}-fixture`,
        roles: { connect: roleIds.map((roleId) => ({ id: roleId })) },
      },
    })
  }

  function call(
    path: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: {
        Origin: 'http://localhost',
        ...(body === undefined || body instanceof Uint8Array
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof Uint8Array
            ? (body as BodyInit)
            : JSON.stringify(body),
    })
  }
  const params = <T>(value: T) => ({ params: Promise.resolve(value) })
  async function json(response: Response) {
    return { status: response.status, body: await response.json() }
  }

  async function createRequest(input: Record<string, unknown> = {}) {
    const response = await json(
      await collection.POST(
        call('/api/file-requests', 'POST', { title: 'Documents', ...input })
      )
    )
    expect(response.status).toBe(201)
    return response.body.request as {
      id: string
      token: string
      status: string
      pausedReason: string | null
    }
  }

  async function startBatch(
    token: string,
    input: Record<string, unknown> = {}
  ) {
    return json(
      await submissions.POST(
        call(`/api/r/${token}/submissions`, 'POST', input),
        params({ token })
      )
    )
  }

  async function begin(
    token: string,
    submission: { id: string; key: string },
    filename: string,
    bytes: Buffer,
    mimeType: string,
    extra: Record<string, unknown> = {}
  ) {
    return json(
      await uploads.POST(
        call(
          `/api/r/${token}/uploads`,
          'POST',
          {
            submissionId: submission.id,
            filename,
            mimeType,
            size: bytes.length,
            ...extra,
          },
          { 'X-Flare-Submission-Key': submission.key }
        ),
        params({ token })
      )
    )
  }

  async function putPart(
    token: string,
    key: string,
    uploadId: string,
    partNumber: number,
    bytes: Buffer
  ) {
    return json(
      await parts.PUT(
        call(
          `/api/r/${token}/uploads/${uploadId}/parts/${partNumber}`,
          'PUT',
          new Uint8Array(bytes),
          { 'X-Flare-Submission-Key': key }
        ),
        params({ token, uploadId, partNumber: String(partNumber) })
      )
    )
  }

  async function complete(token: string, key: string, uploadId: string) {
    return json(
      await completion.POST(
        call(
          `/api/r/${token}/uploads/${uploadId}/complete`,
          'POST',
          undefined,
          {
            'X-Flare-Submission-Key': key,
          }
        ),
        params({ token, uploadId })
      )
    )
  }

  async function cancel(token: string, key: string, uploadId: string) {
    return json(
      await cancellation.DELETE(
        call(`/api/r/${token}/uploads/${uploadId}`, 'DELETE', undefined, {
          'X-Flare-Submission-Key': key,
        }),
        params({ token, uploadId })
      )
    )
  }

  /** The browser's sequence: start, every part, complete. */
  async function send(
    token: string,
    submission: { id: string; key: string },
    filename: string,
    bytes: Buffer,
    mimeType = 'text/plain'
  ) {
    const started = await begin(token, submission, filename, bytes, mimeType)
    if (started.status !== 201) return started
    const { uploadId, partSize } = started.body
    for (let offset = 0, part = 1; offset < bytes.length; offset += partSize)
      expect(
        (
          await putPart(
            token,
            submission.key,
            uploadId,
            part++,
            bytes.subarray(offset, offset + partSize)
          )
        ).status
      ).toBe(200)
    return complete(token, submission.key, uploadId)
  }

  async function finish(
    token: string,
    submission: { id: string; key: string }
  ) {
    return json(
      await finishRoute.POST(
        call(
          `/api/r/${token}/submissions/${submission.id}/complete`,
          'POST',
          undefined,
          { 'X-Flare-Submission-Key': submission.key }
        ),
        params({ token, id: submission.id })
      )
    )
  }

  it('lets permitted owners manage requests through session-only routes', async () => {
    const request = await createRequest({
      title: 'Tax documents 2026',
      message: 'PDFs please.',
      maxFiles: 10,
      expiresInHours: 24,
    })
    expect(request.status).toBe('open')
    expect(request.token).toMatch(/^[A-Za-z0-9_-]{24}$/)

    const list = await json(
      await collection.GET(call('/api/file-requests', 'GET'))
    )
    expect(list.body.requests).toHaveLength(1)
    expect(list.body.policy).toMatchObject({ canCreate: true, openCount: 1 })

    const patched = await json(
      await detail.PATCH(
        call(`/api/file-requests/${request.id}`, 'PATCH', {
          title: 'Taxes',
          closed: true,
        }),
        params({ id: request.id })
      )
    )
    expect(patched.body.request).toMatchObject({
      title: 'Taxes',
      status: 'closed',
    })
    const ended = await json(
      await collection.GET(call('/api/file-requests?status=ended', 'GET'))
    )
    expect(ended.body.requests.map((item: { id: string }) => item.id)).toEqual([
      request.id,
    ])

    const replaced = await json(
      await detail.PATCH(
        call(`/api/file-requests/${request.id}`, 'PATCH', {
          replaceLink: true,
          closed: false,
        }),
        params({ id: request.id })
      )
    )
    expect(replaced.body.request.token).not.toBe(request.token)
    expect(replaced.body.request.status).toBe('open')

    // Cross-origin writes, bearer-only callers, and other accounts are refused.
    expect(
      (
        await collection.POST(
          call(
            '/api/file-requests',
            'POST',
            { title: 'x' },
            { Origin: 'https://attacker.example' }
          )
        )
      ).status
    ).toBe(403)
    state.userId = null
    expect(
      (
        await collection.GET(
          call('/api/file-requests', 'GET', undefined, {
            Authorization: 'Bearer flr_not-for-this-route',
          })
        )
      ).status
    ).toBe(401)
    state.userId = 'member'
    expect(
      (await collection.GET(call('/api/file-requests', 'GET'))).status
    ).toBe(403)

    state.userId = 'owner'
    expect(
      (
        await detail.DELETE(
          call(`/api/file-requests/${request.id}`, 'DELETE'),
          params({ id: request.id })
        )
      ).status
    ).toBe(200)
    expect(await prisma.fileRequest.count()).toBe(0)
  })

  it('validates destinations against the owner and their roles', async () => {
    const strangerProfile = await prisma.uploadProfile.create({
      data: { userId: 'member', name: 'Theirs', options: {} },
    })
    const strangerFolder = await prisma.vaultFolder.create({
      data: { userId: 'member', name: 'Theirs', normalizedName: 'theirs' },
    })
    for (const body of [
      { title: 'x', profileId: strangerProfile.id },
      { title: 'x', folderId: strangerFolder.id },
    ])
      expect(
        (await collection.POST(call('/api/file-requests', 'POST', body))).status
      ).toBe(404)

    // A member who may request files but not tag them can't pick a tagging profile.
    const role = await prisma.role.create({
      data: {
        name: 'Requesters',
        position: 10,
        permissions: ['files.upload', 'fileRequests.manage'],
      },
    })
    await prisma.user.update({
      where: { id: 'member' },
      data: { roles: { connect: { id: role.id } } },
    })
    await prisma.role.update({
      where: { id: builtins.everyone.id },
      data: { permissions: [] },
    })
    const tag = await prisma.vaultTag.create({
      data: { userId: 'member', name: 'Clients', normalizedName: 'clients' },
    })
    const tagging = await prisma.uploadProfile.create({
      data: {
        userId: 'member',
        name: 'Tagging',
        options: { tagIds: [tag.id] },
      },
    })
    state.userId = 'member'
    const refused = await json(
      await collection.POST(
        call('/api/file-requests', 'POST', {
          title: 'x',
          profileId: tagging.id,
        })
      )
    )
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/adds tags/)
    expect(
      (
        await collection.POST(
          call('/api/file-requests', 'POST', { title: 'x' })
        )
      ).status
    ).toBe(201)
  })

  it('delivers files privately with the profile, folder, and counters', async () => {
    const tag = await prisma.vaultTag.create({
      data: { userId: 'owner', name: 'Clients', normalizedName: 'clients' },
    })
    const folder = await prisma.vaultFolder.create({
      data: { userId: 'owner', name: 'Acme', normalizedName: 'acme' },
    })
    // Visibility is ignored and a deletion schedule is kept.
    const profile = await prisma.uploadProfile.create({
      data: {
        userId: 'owner',
        name: 'Deliveries',
        options: {
          visibility: 'PUBLIC',
          tagIds: [tag.id],
          randomizeFileUrls: true,
          expiration: 'WEEK',
          expiryAction: 'DELETE',
        },
      },
    })
    const request = await createRequest({
      profileId: profile.id,
      folderId: folder.id,
    })
    const batch = await startBatch(request.token, {
      senderName: 'Sam Lee',
      note: 'Here you go',
    })
    expect(batch.status).toBe(201)
    expect(batch.body.request).toMatchObject({
      title: 'Documents',
      ownerName: 'Alex Owner',
      filesRemaining: null,
    })
    const submission = batch.body.submission

    // Six MiB arrive in two parts.
    const large = Buffer.alloc(6 * 1024 * 1024, 'a')
    const first = await send(request.token, submission, 'notes.txt', large)
    expect(first).toEqual({
      status: 200,
      body: {
        file: { name: 'notes.txt', sizeBytes: large.length },
        remaining: { files: null, bytes: null },
      },
    })
    expect(
      (await send(request.token, submission, 'pixel.png', PNG, 'image/png'))
        .status
    ).toBe(200)
    expect((await finish(request.token, submission)).body).toEqual({
      fileCount: 2,
      bytes: large.length + PNG.length,
    })

    const files = await prisma.file.findMany({
      orderBy: { uploadedAt: 'asc' },
      include: { tags: true },
    })
    expect(files).toHaveLength(2)
    for (const file of files) {
      expect(file).toMatchObject({
        userId: 'owner',
        visibility: 'PRIVATE',
        folderId: folder.id,
        fileRequestSubmissionId: submission.id,
        password: null,
      })
      expect(file.tags.map((entry) => entry.tagId)).toEqual([tag.id])
      expect(file.urlPath).not.toContain(file.name.split('.')[0])
    }
    expect(
      await prisma.event.count({ where: { type: 'file.schedule-expiration' } })
    ).toBe(2)
    expect(state.ocr).toHaveBeenCalledTimes(1)
    const owner = await prisma.user.findUniqueOrThrow({
      where: { id: 'owner' },
    })
    expect(owner.storageUsed * 1024 ** 2).toBeCloseTo(large.length + PNG.length)
    const stored = await prisma.fileRequest.findUniqueOrThrow({
      where: { id: request.id },
    })
    expect(stored.fileCount).toBe(2)
    expect(Number(stored.bytesReceived)).toBe(large.length + PNG.length)
    expect(
      await prisma.auditEvent.count({
        where: { action: 'file_request.received' },
      })
    ).toBe(2)
    // Audit details never carry the link, key digests, or what senders typed.
    const audit = JSON.stringify(await prisma.auditEvent.findMany())
    expect(audit).not.toContain(request.token)
    expect(audit).not.toContain(submission.key)
    expect(audit).not.toContain('Sam Lee')

    // The owner sees the batch, which marks the arrivals as seen.
    const view = await json(
      await detail.GET(
        call(`/api/file-requests/${request.id}`, 'GET'),
        params({ id: request.id })
      )
    )
    expect(view.body.request.unseen).toBe(true)
    expect(view.body.submissions).toHaveLength(1)
    expect(view.body.submissions[0]).toMatchObject({
      senderName: 'Sam Lee',
      note: 'Here you go',
      fileCount: 2,
      remainingFiles: 0,
    })
    const again = await json(
      await detail.GET(
        call(`/api/file-requests/${request.id}`, 'GET'),
        params({ id: request.id })
      )
    )
    expect(again.body.request.unseen).toBe(false)

    // Deleting the request keeps the files and unlinks them.
    await detail.DELETE(
      call(`/api/file-requests/${request.id}`, 'DELETE'),
      params({ id: request.id })
    )
    expect(await prisma.file.count()).toBe(2)
    expect(
      await prisma.file.count({ where: { fileRequestSubmissionId: null } })
    ).toBe(2)
  })

  it('makes completion repeatable and requires every part', async () => {
    const request = await createRequest()
    const { body } = await startBatch(request.token)
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 10, 'b')
    const started = await begin(
      request.token,
      body.submission,
      'big.txt',
      bytes,
      'text/plain'
    )
    const { uploadId, partSize } = started.body
    await putPart(
      request.token,
      body.submission.key,
      uploadId,
      2,
      bytes.subarray(partSize)
    )
    const missing = await complete(request.token, body.submission.key, uploadId)
    expect(missing.status).toBe(400)
    expect(missing.body.code).toBe('incomplete_upload')
    // Parts have exactly the size and count the start response implied.
    for (const [part, data] of [
      [1, text('short')],
      [3, text('extra')],
    ] as const) {
      const refused = await putPart(
        request.token,
        body.submission.key,
        uploadId,
        part,
        data
      )
      expect(refused.status).toBe(400)
      expect(refused.body.code).toBe('part_size')
    }
    await putPart(
      request.token,
      body.submission.key,
      uploadId,
      1,
      bytes.subarray(0, partSize)
    )
    const done = await complete(request.token, body.submission.key, uploadId)
    expect(done.status).toBe(200)
    expect(
      await complete(request.token, body.submission.key, uploadId)
    ).toEqual(done)
    expect(await prisma.file.count()).toBe(1)
  })

  it('counts files on their way against limits and caps them per batch', async () => {
    const request = await createRequest({ maxFiles: 1 })
    const { body } = await startBatch(request.token)
    const a = await begin(
      request.token,
      body.submission,
      'a.txt',
      text('aaa'),
      'text/plain'
    )
    expect(a.status).toBe(201)
    // The only slot is taken by a file still on its way.
    const b = await begin(
      request.token,
      body.submission,
      'b.txt',
      text('bbb'),
      'text/plain'
    )
    expect(b.status).toBe(409)
    expect(b.body.code).toBe('request_limit')
    await putPart(
      request.token,
      body.submission.key,
      a.body.uploadId,
      1,
      text('aaa')
    )
    expect(
      (await complete(request.token, body.submission.key, a.body.uploadId))
        .status
    ).toBe(200)
    expect(await prisma.fileRequestUpload.count()).toBe(0)
    expect((await startBatch(request.token)).body.code).toBe('full')

    // Bytes on their way count too, and so does the owner's quota.
    const sized = await createRequest({ maxBytes: 1024 * 1024 })
    const batch = (await startBatch(sized.token)).body.submission
    expect(
      (
        await begin(
          sized.token,
          batch,
          'one.bin',
          Buffer.alloc(700 * 1024),
          'application/octet-stream'
        )
      ).status
    ).toBe(201)
    const second = await begin(
      sized.token,
      batch,
      'two.bin',
      Buffer.alloc(400 * 1024),
      'application/octet-stream'
    )
    expect(second.status).toBe(413)
    expect(second.body.code).toBe('request_limit')

    // One batch can have three files on their way at once.
    const open = await createRequest()
    const sender = (await startBatch(open.token)).body.submission
    for (const name of ['1.txt', '2.txt', '3.txt'])
      expect(
        (await begin(open.token, sender, name, text(name), 'text/plain')).status
      ).toBe(201)
    const fourth = await begin(
      open.token,
      sender,
      '4.txt',
      text('4'),
      'text/plain'
    )
    expect(fourth.status).toBe(409)
    expect(fourth.body.code).toBe('too_many_uploads')

    // Ten minutes without a part release a reservation and discard its parts.
    await prisma.fileRequestUpload.updateMany({
      where: { submissionId: sender.id },
      data: { touchedAt: new Date(Date.now() - 11 * 60 * 1000) },
    })
    expect(state.multipart.size).toBe(4)
    expect(
      (await begin(open.token, sender, '5.txt', text('5'), 'text/plain')).status
    ).toBe(201)
    expect(state.multipart.size).toBe(2)
    expect(state.aborted.size).toBe(3)
  })

  it('lets a sender cancel a file and give its room back', async () => {
    const request = await createRequest({ maxFiles: 1 })
    const sender = (await startBatch(request.token)).body.submission
    const first = await begin(
      request.token,
      sender,
      'a.txt',
      text('aaa'),
      'text/plain'
    )
    await putPart(
      request.token,
      sender.key,
      first.body.uploadId,
      1,
      text('aaa')
    )
    expect(
      await cancel(request.token, sender.key, first.body.uploadId)
    ).toEqual({ status: 200, body: { cancelled: true } })
    expect(await prisma.fileRequestUpload.count()).toBe(0)
    expect(state.multipart.size).toBe(0)
    expect(
      (await complete(request.token, sender.key, first.body.uploadId)).body.code
    ).toBe('upload_not_found')
    // The only slot is free again.
    expect(
      (await send(request.token, sender, 'a.txt', text('aaa'))).status
    ).toBe(200)
    expect((await prisma.file.findFirstOrThrow()).name).toBe('a.txt')
  })

  it('holds limits under concurrent deliveries and rejects late arrivals', async () => {
    const request = await createRequest({ maxFiles: 2 })
    const { body } = await startBatch(request.token)
    const a = await begin(
      request.token,
      body.submission,
      'a.txt',
      text('aaa'),
      'text/plain'
    )
    const b = await begin(
      request.token,
      body.submission,
      'b.txt',
      text('bbb'),
      'text/plain'
    )
    await putPart(
      request.token,
      body.submission.key,
      a.body.uploadId,
      1,
      text('aaa')
    )
    await putPart(
      request.token,
      body.submission.key,
      b.body.uploadId,
      1,
      text('bbb')
    )
    // The owner lowers the limit while both files are on their way.
    await detail.PATCH(
      call(`/api/file-requests/${request.id}`, 'PATCH', { maxFiles: 1 }),
      params({ id: request.id })
    )
    const results = await Promise.all([
      complete(request.token, body.submission.key, a.body.uploadId),
      complete(request.token, body.submission.key, b.body.uploadId),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(results.find((result) => result.status === 409)?.body.code).toBe(
      'full'
    )
    expect(await prisma.file.count()).toBe(1)
    // The refused file's bytes and parts are gone, and so is its reservation.
    expect(state.objects.size).toBe(1)
    expect(state.multipart.size).toBe(0)
    expect(await prisma.fileRequestUpload.count()).toBe(0)

    // Closing stops parts and completions of files already on their way.
    state.aborted.clear()
    const live = await createRequest()
    const sender = (await startBatch(live.token)).body.submission
    const started = await begin(
      live.token,
      sender,
      'late.txt',
      text('late'),
      'text/plain'
    )
    await putPart(
      live.token,
      sender.key,
      started.body.uploadId,
      1,
      text('late')
    )
    await detail.PATCH(
      call(`/api/file-requests/${live.id}`, 'PATCH', { closed: true }),
      params({ id: live.id })
    )
    const part = await putPart(
      live.token,
      sender.key,
      started.body.uploadId,
      1,
      text('late')
    )
    expect(part.status).toBe(410)
    expect(part.body.code).toBe('closed')
    const late = await complete(live.token, sender.key, started.body.uploadId)
    expect(late.status).toBe(410)
    expect(late.body.code).toBe('closed')
    // Its parts were never assembled, so they were discarded.
    expect(state.aborted.size).toBe(1)
    expect(state.multipart.size).toBe(0)
    expect(await prisma.fileRequestUpload.count()).toBe(0)

    // Replacing the link revokes sessions started from the old one.
    await detail.PATCH(
      call(`/api/file-requests/${live.id}`, 'PATCH', {
        closed: false,
        replaceLink: true,
      }),
      params({ id: live.id })
    )
    const revoked = await begin(
      live.token,
      sender,
      'x.txt',
      text('x'),
      'text/plain'
    )
    expect(revoked.status).toBe(403)
    expect(revoked.body.code).toBe('invalid_session')
    expect(await prisma.file.count()).toBe(1)
  })

  it('puts a file in Unfiled when its folder is deleted while it uploads', async () => {
    const folder = await prisma.vaultFolder.create({
      data: { userId: 'owner', name: 'Gone soon', normalizedName: 'gone soon' },
    })
    const request = await createRequest({ folderId: folder.id })
    const sender = (await startBatch(request.token)).body.submission
    const started = await begin(
      request.token,
      sender,
      'a.txt',
      text('a'),
      'text/plain'
    )
    await putPart(
      request.token,
      sender.key,
      started.body.uploadId,
      1,
      text('a')
    )
    await prisma.vaultFolder.delete({ where: { id: folder.id } })
    expect(
      (await complete(request.token, sender.key, started.body.uploadId)).status
    ).toBe(200)
    expect(await prisma.file.findFirst()).toMatchObject({ folderId: null })
  })

  it('stops a file whose link was replaced while it completed', async () => {
    const request = await createRequest()
    const sender = (await startBatch(request.token)).body.submission
    const started = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain'
    )
    await putPart(
      request.token,
      sender.key,
      started.body.uploadId,
      1,
      text('abc')
    )
    state.onComplete = async () => {
      state.onComplete = undefined
      await prisma.fileRequest.update({
        where: { id: request.id },
        data: { token: 'R'.repeat(24) },
      })
    }
    const result = await complete(
      request.token,
      sender.key,
      started.body.uploadId
    )
    expect(result.status).toBe(404)
    expect(result.body.code).toBe('invalid')
    expect(await prisma.file.count()).toBe(0)
    // Its bytes and its hold on the request are released.
    expect(state.objects.size).toBe(0)
    expect(await prisma.fileRequestUpload.count()).toBe(0)
  })

  /** Holds each delivery open for a second after it releases its reservation. */
  async function pauseDeliveries() {
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION pause_delivery() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(1); RETURN OLD; END $$ LANGUAGE plpgsql`
    )
    await prisma.$executeRawUnsafe(
      'CREATE OR REPLACE TRIGGER pause_delivery AFTER DELETE ON "FileRequestUpload" FOR EACH ROW EXECUTE FUNCTION pause_delivery()'
    )
    return async () => {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER pause_delivery ON "FileRequestUpload"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION pause_delivery()')
    }
  }

  async function deliveryPaused() {
    for (let attempt = 0; attempt < 250; attempt++) {
      const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'PgSleep'`
      if (count > BigInt(0)) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('No delivery paused.')
  }

  it('answers a completion retry that overlaps its delivery', async () => {
    const request = await createRequest()
    const sender = (await startBatch(request.token)).body.submission
    const started = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain'
    )
    await putPart(
      request.token,
      sender.key,
      started.body.uploadId,
      1,
      text('abc')
    )
    const resume = await pauseDeliveries()
    try {
      const first = complete(request.token, sender.key, started.body.uploadId)
      // The retry arrives after the first released the file's reservation,
      // before it commits.
      await deliveryPaused()
      const retry = await complete(
        request.token,
        sender.key,
        started.body.uploadId
      )
      const delivered = await first
      expect(delivered.status).toBe(200)
      expect(retry).toEqual(delivered)
    } finally {
      await resume()
    }
    expect(await prisma.file.count()).toBe(1)
  })

  it('serializes quota holds across all of an owner’s requests', async () => {
    const one = await createRequest({ title: 'One' })
    const two = await createRequest({ title: 'Two' })
    await saveConfig((config) => {
      config.settings.general.storage.quotas = {
        enabled: true,
        default: { value: 10, unit: 'MB' },
      }
    })
    await prisma.role.update({
      where: { id: builtins.administrator.id },
      data: { permissions: ['files.upload', 'fileRequests.manage'] },
    })
    const a = (await startBatch(one.token)).body.submission
    const b = (await startBatch(two.token)).body.submission
    const six = Buffer.alloc(6 * 1024 * 1024)
    const results = await Promise.all([
      begin(one.token, a, 'a.bin', six, 'application/octet-stream'),
      begin(two.token, b, 'b.bin', six, 'application/octet-stream'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([201, 413])
    expect(results.find((result) => result.status === 413)?.body.code).toBe(
      'quota'
    )
    expect(await prisma.fileRequestUpload.count()).toBe(1)
  })

  it('discards a part written after its upload was cancelled', async () => {
    const request = await createRequest()
    const sender = (await startBatch(request.token)).body.submission
    const started = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain'
    )
    const [storageId] = [...state.multipart.keys()]
    // The cancel lands while this part is still arriving.
    state.onPart = async () => {
      state.onPart = undefined
      expect(
        (await cancel(request.token, sender.key, started.body.uploadId)).status
      ).toBe(200)
    }
    const late = await putPart(
      request.token,
      sender.key,
      started.body.uploadId,
      1,
      text('abc')
    )
    expect(late.status).toBe(404)
    expect(state.multipart.has(storageId)).toBe(false)
  })

  it('returns the same upload when a start is retried with its key', async () => {
    const request = await createRequest({ maxFiles: 1 })
    const sender = (await startBatch(request.token)).body.submission
    const retry = { clientKey: 'retry-key-0123456789' }
    const first = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain',
      retry
    )
    const again = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain',
      retry
    )
    expect(again.status).toBe(201)
    expect(again.body.uploadId).toBe(first.body.uploadId)
    expect(await prisma.fileRequestUpload.count()).toBe(1)
    expect(state.multipart.size).toBe(1)
    // A different file still respects the request's one slot.
    const other = await begin(
      request.token,
      sender,
      'b.txt',
      text('b'),
      'text/plain',
      { clientKey: 'another-key-01234567' }
    )
    expect(other.body.code).toBe('request_limit')
    // A key names one file: repeating it for another size is refused.
    const reused = await begin(
      request.token,
      sender,
      'a.txt',
      text('abcd'),
      'text/plain',
      retry
    )
    expect(reused.status).toBe(409)
    expect(reused.body.code).toBe('client_key_reused')
  })

  it('asks a start repeated mid-setup to try again', async () => {
    const request = await createRequest()
    const sender = (await startBatch(request.token)).body.submission
    const retry = { clientKey: 'racing-key-012345678' }
    let early: Awaited<ReturnType<typeof begin>> | undefined
    // The repeat arrives after the first start reserved its place, before
    // its upload exists.
    state.onInit = async () => {
      state.onInit = undefined
      early = await begin(
        request.token,
        sender,
        'a.txt',
        text('abc'),
        'text/plain',
        retry
      )
    }
    const first = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain',
      retry
    )
    expect(first.status).toBe(201)
    expect(early?.status).toBe(503)
    expect(early?.body.code).toBe('starting')
    const later = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain',
      retry
    )
    expect(later.body.uploadId).toBe(first.body.uploadId)
    expect(await prisma.fileRequestUpload.count()).toBe(1)
  })

  it('keeps a session for the next sweep when discarding its parts fails', async () => {
    const request = await createRequest()
    const sender = (await startBatch(request.token)).body.submission
    const started = await begin(
      request.token,
      sender,
      'a.txt',
      text('abc'),
      'text/plain'
    )
    const [storageId] = [...state.multipart.keys()]
    state.failAbort = 1
    expect(
      await cancel(request.token, sender.key, started.body.uploadId)
    ).toEqual({ status: 200, body: { cancelled: true } })
    expect(state.multipart.has(storageId)).toBe(true)
    // The cancelled file can't continue, even though its session remains.
    expect(
      (
        await putPart(
          request.token,
          sender.key,
          started.body.uploadId,
          1,
          text('abc')
        )
      ).body.code
    ).toBe('upload_not_found')
    expect(
      (await complete(request.token, sender.key, started.body.uploadId)).body
        .code
    ).toBe('upload_not_found')
    const { discardUploadSession } = await import('@/lib/uploads/chunks')
    await discardUploadSession(started.body.uploadId)
    expect(state.multipart.has(storageId)).toBe(false)
  })

  it('asks for names when required and checks the owner quota', async () => {
    const request = await createRequest({ senderName: 'required' })
    const unnamed = await startBatch(request.token, { senderName: '  ' })
    expect(unnamed.status).toBe(400)
    expect(unnamed.body.code).toBe('name_required')
    const named = await startBatch(request.token, { senderName: 'Riley' })
    expect(named.status).toBe(201)
    const quiet = await createRequest({ senderName: 'off' })
    await startBatch(quiet.token, { senderName: 'Ignored' })
    expect(
      await prisma.fileRequestSubmission.findFirst({
        where: { requestId: quiet.id },
      })
    ).toMatchObject({ senderName: '' })

    await saveConfig((config) => {
      config.settings.general.storage.quotas = {
        enabled: true,
        default: { value: 1, unit: 'MB' },
      }
    })
    // Administrators bypass quotas only when they hold quotas.bypass explicitly.
    await prisma.role.update({
      where: { id: builtins.administrator.id },
      data: { permissions: ['files.upload', 'fileRequests.manage'] },
    })
    const full = await begin(
      request.token,
      named.body.submission,
      'big.bin',
      Buffer.alloc(2 * 1024 * 1024),
      'application/octet-stream'
    )
    expect(full.status).toBe(413)
    expect(full.body.code).toBe('quota')
  })

  it('pauses links when the owner loses access, without telling senders why', async () => {
    const role = await prisma.role.create({
      data: {
        name: 'Requesters',
        position: 10,
        permissions: ['files.upload', 'fileRequests.manage', 'folders.manage'],
      },
    })
    await prisma.user.update({
      where: { id: 'member' },
      data: { roles: { connect: { id: role.id } } },
    })
    const folder = await prisma.vaultFolder.create({
      data: { userId: 'member', name: 'Inbox', normalizedName: 'inbox' },
    })
    // Only the role grants these, so changing it changes the member's access.
    await prisma.role.update({
      where: { id: builtins.everyone.id },
      data: { permissions: [] },
    })
    state.userId = 'member'
    const request = await createRequest({ folderId: folder.id })
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: ['files.upload', 'fileRequests.manage'] },
    })
    const list = await json(
      await collection.GET(call('/api/file-requests', 'GET'))
    )
    expect(list.body.requests[0]).toMatchObject({
      status: 'paused',
      pausedReason: expect.stringMatching(/folders/),
    })
    const paused = await startBatch(request.token)
    expect(paused.status).toBe(409)
    expect(paused.body).toEqual({
      code: 'paused',
      error:
        'This request can’t accept files right now. Try again later, or let the person who sent you the link know.',
    })
    // Unrelated edits still save; moving to Unfiled resumes the request.
    const renamed = await json(
      await detail.PATCH(
        call(`/api/file-requests/${request.id}`, 'PATCH', { title: 'Renamed' }),
        params({ id: request.id })
      )
    )
    expect(renamed.status).toBe(200)
    const moved = await json(
      await detail.PATCH(
        call(`/api/file-requests/${request.id}`, 'PATCH', { folderId: null }),
        params({ id: request.id })
      )
    )
    expect(moved.body.request).toMatchObject({ status: 'open', folder: null })
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: ['files.upload', 'folders.manage'] },
    })
    expect((await service.inspectFileRequest(request.token)).status).toBe(
      'paused'
    )
  })

  it('keeps sender upload sessions apart from owner chunk routes', async () => {
    const request = await createRequest()
    const one = (await startBatch(request.token)).body.submission
    const two = (await startBatch(request.token)).body.submission
    const started = await begin(
      request.token,
      one,
      'a.txt',
      text('a'),
      'text/plain'
    )
    const uploadId = started.body.uploadId
    // Another sender's key can't reach this upload.
    const crossed = await putPart(
      request.token,
      two.key,
      uploadId,
      1,
      text('a')
    )
    expect(crossed.status).toBe(404)
    // The owner's session routes don't accept a sender's upload either.
    const owner = await ownerParts.PUT(
      call(
        `/api/files/chunks/${uploadId}/part/1`,
        'PUT',
        new Uint8Array(text('a'))
      ),
      params({ uploadId, partNumber: '1' })
    )
    expect(owner.status).toBe(404)
  })

  async function enableEmail() {
    await saveConfig((config) => {
      config.settings.email = {
        ...config.settings.email,
        enabled: true,
        smtp: {
          ...config.settings.email.smtp,
          host: 'smtp.example.test',
          authentication: false,
        },
        fromAddress: 'flare@example.test',
        publicUrl: 'http://localhost',
      }
    })
  }
  async function mailText(id: string) {
    const { decryptSecret } = await import('@/lib/email/crypto')
    const mail = await prisma.mailOutbox.findUniqueOrThrow({ where: { id } })
    return JSON.parse(decryptSecret(mail.payload, 'outbox')).text as string
  }

  it('emails the owner once per batch and batches later arrivals', async () => {
    await enableEmail()
    const request = await createRequest({ notify: true })
    const first = (
      await startBatch(request.token, {
        senderName: 'Visit https://phish.example',
        note: 'Your account is suspended',
      })
    ).body.submission
    await send(request.token, first, 'one.txt', text('one'))
    // Until the batch finishes, a fallback digest waits.
    expect(await prisma.mailOutbox.count()).toBe(0)
    expect(
      await prisma.event.count({ where: { type: 'file-request.notify' } })
    ).toBe(1)
    await finish(request.token, first)
    const mail = await prisma.mailOutbox.findMany()
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({
      purpose: 'file_request',
      recipient: 'owner@example.test',
      userId: 'owner',
    })
    // Nothing a sender typed reaches the owner's inbox.
    const body = await mailText(mail[0].id)
    expect(body).toContain('received 1 file')
    expect(body).not.toContain('phish')
    expect(body).not.toContain('suspended')
    expect(
      await prisma.event.count({ where: { type: 'file-request.notify' } })
    ).toBe(0)

    // A second batch within ten minutes waits for one scheduled digest.
    const second = (await startBatch(request.token, { senderName: 'Jo' })).body
      .submission
    await send(request.token, second, 'two.txt', text('two'))
    await finish(request.token, second)
    expect(await prisma.mailOutbox.count()).toBe(1)
    const waiting = await prisma.event.findMany({
      where: { type: 'file-request.notify' },
    })
    expect(waiting).toHaveLength(1)
    const { notifiedAt } = await prisma.fileRequest.findUniqueOrThrow({
      where: { id: request.id },
    })
    expect(waiting[0].scheduledAt?.getTime()).toBe(
      notifiedAt!.getTime() + 10 * 60 * 1000
    )
    // Once the interval passes, the digest goes out and covers only new files.
    await prisma.fileRequest.update({
      where: { id: request.id },
      data: { notifiedAt: new Date(Date.now() - 11 * 60 * 1000) },
    })
    await notify.sendScheduledDigest(request.id)
    expect(await prisma.mailOutbox.count()).toBe(2)
    await notify.sendScheduledDigest(request.id)
    expect(await prisma.mailOutbox.count()).toBe(2)
  })

  it('keeps arrivals unreported when their email can’t be queued', async () => {
    await enableEmail()
    const request = await createRequest({ notify: true })
    const sender = (await startBatch(request.token)).body.submission
    await send(request.token, sender, 'one.txt', text('one'))
    // The outbox insert fails inside the transaction that would mark the
    // arrivals reported.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION fail_mail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END $$ LANGUAGE plpgsql`
    )
    await prisma.$executeRawUnsafe(
      'CREATE OR REPLACE TRIGGER fail_mail BEFORE INSERT ON "MailOutbox" FOR EACH ROW EXECUTE FUNCTION fail_mail()'
    )
    try {
      expect((await finish(request.token, sender)).status).toBe(200)
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_mail ON "MailOutbox"')
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_mail()')
    }
    expect(await prisma.mailOutbox.count()).toBe(0)
    expect(
      (
        await prisma.fileRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).notifiedAt
    ).toBeNull()
    // The digest scheduled by the arrival still waits, and sends it once
    // queuing works again.
    expect(
      await prisma.event.count({
        where: { type: 'file-request.notify', status: 'SCHEDULED' },
      })
    ).toBe(1)
    await notify.sendScheduledDigest(request.id)
    const [mail] = await prisma.mailOutbox.findMany()
    expect(await mailText(mail.id)).toContain('received 1 file')
    expect(
      await prisma.event.count({ where: { type: 'file-request.notify' } })
    ).toBe(0)
  })

  it('leaves a delivery still committing for the next email', async () => {
    await enableEmail()
    const request = await createRequest({ notify: true })
    const sender = (await startBatch(request.token)).body.submission
    await send(request.token, sender, 'one.txt', text('one'))
    const started = await begin(
      request.token,
      sender,
      'two.txt',
      text('two!'),
      'text/plain'
    )
    await putPart(
      request.token,
      sender.key,
      started.body.uploadId,
      1,
      text('two!')
    )
    const resume = await pauseDeliveries()
    try {
      const second = complete(request.token, sender.key, started.body.uploadId)
      // The email is written while the second file is still committing.
      await deliveryPaused()
      await notify.sendScheduledDigest(request.id)
      expect((await second).status).toBe(200)
    } finally {
      await resume()
    }
    const [first] = await prisma.mailOutbox.findMany()
    expect(await mailText(first.id)).toContain('received 1 file (3 B).')
    // The second file waits for the next email instead of being skipped.
    await prisma.fileRequest.update({
      where: { id: request.id },
      data: { notifiedAt: new Date(Date.now() - 11 * 60 * 1000) },
    })
    await notify.sendScheduledDigest(request.id)
    const mails = await prisma.mailOutbox.findMany({
      orderBy: { createdAt: 'asc' },
    })
    expect(mails).toHaveLength(2)
    expect(await mailText(mails[1].id)).toContain('received 1 file (4 B).')
  })

  it('starts email from now and keeps it within daily caps', async () => {
    await enableEmail()
    const request = await createRequest()
    const early = (await startBatch(request.token)).body.submission
    await send(request.token, early, 'early.txt', text('early'))
    await finish(request.token, early)
    // Turning email on later reports only what arrives afterward, even a
    // file from a moment ago, and the first email isn't held back.
    await detail.PATCH(
      call(`/api/file-requests/${request.id}`, 'PATCH', { notify: true }),
      params({ id: request.id })
    )
    const later = (await startBatch(request.token)).body.submission
    await send(request.token, later, 'later.txt', text('later'))
    await finish(request.token, later)
    const [mail] = await prisma.mailOutbox.findMany()
    expect(await mailText(mail.id)).toContain('received 1 file (5 B).')

    // An owner's daily cap, and room kept for account email, stop more.
    const date = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86_400_000)
    const another = async () => {
      await prisma.fileRequest.update({
        where: { id: request.id },
        data: { notifiedAt: new Date(Date.now() - 11 * 60 * 1000) },
      })
      const batch = (await startBatch(request.token)).body.submission
      await send(request.token, batch, 'more.txt', text('more'))
      await finish(request.token, batch)
    }
    await prisma.emailRateLimit.update({
      where: { key: `file-request:daily:${date}:owner` },
      data: { count: 24 },
    })
    await another()
    expect(await prisma.mailOutbox.count()).toBe(1)
    await prisma.emailRateLimit.deleteMany({
      where: { key: { startsWith: 'file-request:' } },
    })
    await prisma.emailRateLimit.upsert({
      where: { key: `mail:daily:${date}` },
      create: { key: `mail:daily:${date}`, count: 400, resetAt: tomorrow },
      update: { count: 400 },
    })
    await another()
    expect(await prisma.mailOutbox.count()).toBe(1)
  })

  it('grants Request files to everyone from Settings', async () => {
    const put = (body: unknown) =>
      settings.PUT(call('/api/settings/file-requests', 'PUT', body))
    expect((await put({ everyoneCanRequestFiles: true })).status).toBe(200)
    expect(await json(await settings.GET())).toEqual({
      status: 200,
      body: { everyoneCanRequestFiles: true },
    })
    state.userId = 'member'
    expect(
      (await collection.GET(call('/api/file-requests', 'GET'))).status
    ).toBe(200)
    expect((await put({ everyoneCanRequestFiles: false })).status).toBe(403)
    state.userId = 'owner'
    expect((await put({ everyoneCanRequestFiles: false })).status).toBe(200)
    state.userId = 'member'
    expect(
      (await collection.GET(call('/api/file-requests', 'GET'))).status
    ).toBe(403)
  })
})
