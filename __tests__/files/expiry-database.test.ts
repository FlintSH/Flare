import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
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

// A database of its own: these tests claim every due job, and the other
// suites clear the Event table between tests.
const databaseUrl = process.env.FLARE_EXPIRY_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

// Real queries; a full parallel run can take one past the 5 s default.
vi.setConfig({ testTimeout: 30_000 })

suite('file expiry against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let expiry: typeof import('@/lib/files/expiry')
  let uploads: typeof import('@/lib/uploads/finalize')
  let schema: typeof import('@/lib/uploads/schema')
  let storage: import('@/lib/storage').LocalStorageProvider
  const prefix = `uploads/expiry-test-${randomUUID()}`
  const owner = 'expiry-owner'
  const minute = 60_000

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error('Use an explicitly named disposable local _test database')
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    expiry = await import('@/lib/files/expiry')
    uploads = await import('@/lib/uploads/finalize')
    schema = await import('@/lib/uploads/schema')
    storage = new (
      await import('@/lib/storage/providers/local')
    ).LocalStorageProvider()
  })

  beforeEach(async () => {
    await prisma.event.deleteMany()
    await prisma.auditEvent.deleteMany()
    await prisma.user.deleteMany()
    await prisma.user.create({
      data: { id: owner, name: owner, urlId: owner, uploadToken: owner },
    })
  })

  afterEach(() => vi.useRealTimers())

  afterAll(async () => {
    await prisma?.$disconnect()
    await rm(join(process.cwd(), prefix), { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  const at = (time: Date | number) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(time)
  }

  async function file(uploadOptions?: Record<string, unknown>) {
    const id = randomUUID()
    return prisma.file.create({
      data: {
        id,
        name: `${id}.txt`,
        path: `${prefix}/${id}.txt`,
        urlPath: `/${owner}/${id}.txt`,
        userId: owner,
        mimeType: 'text/plain',
        size: 1,
        uploadOptions: uploadOptions as never,
      },
    })
  }

  // A row as an earlier version wrote it.
  async function job(
    fileId: string,
    scheduledAt: Date,
    action: string,
    overrides: Record<string, unknown> = {}
  ) {
    return prisma.event.create({
      data: {
        type: 'file.schedule-expiration',
        status: 'SCHEDULED',
        scheduledAt,
        payload: { fileId, userId: owner, fileName: 'notes.txt', action },
        ...overrides,
      },
    })
  }

  const audits = (action: string) =>
    prisma.auditEvent.count({ where: { action } })

  it('applies an upload whose deadline was sent with an offset and no seconds', async () => {
    const deadline = new Date(Date.now() + 60 * minute)
    deadline.setUTCSeconds(0, 0)
    const local = new Date(deadline.getTime() + 2 * 60 * minute)
    const offsetForm = `${local.toISOString().slice(0, 16)}+0200`
    const filePath = `${prefix}/${randomUUID()}.txt`
    await storage.uploadFile(Buffer.from('expiring'), filePath, 'text/plain')
    const { getUserAccess } = await import('@/lib/permissions/server')
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner } })
    const uploaded = await uploads.finalizeUpload({
      user: {
        ...user,
        ...(await getUserAccess(owner)),
        credential: 'session',
      },
      storage,
      filePath,
      urlPath: `/${owner}/${randomUUID()}.txt`,
      displayName: 'notes.txt',
      mimeType: 'text/plain',
      size: 8,
      options: schema.mergeUploadOptions(
        {},
        {},
        { expiresAt: offsetForm, expiryAction: 'DELETE' }
      ),
    })
    expect(uploaded.uploadOptions).toMatchObject({
      expiresAt: deadline.toISOString(),
    })
    const scheduled = await prisma.event.findFirstOrThrow()
    expect(scheduled.scheduledAt).toEqual(deadline)
    expect(scheduled.payload).toMatchObject({
      expiresAt: deadline.toISOString(),
    })
    expect(
      (await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'file.expiration.scheduled' },
      }))!.details
    ).toMatchObject({ ownerId: owner, expiresAt: deadline.toISOString() })

    await expiry.processDueExpirations()
    expect(await prisma.file.count()).toBe(1)
    at(deadline.getTime() + 1000)
    await expiry.processDueExpirations()
    expect(await prisma.file.count()).toBe(0)
    await expect(stat(join(process.cwd(), filePath))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: owner } }))
        .storageUsed
    ).toBe(0)
    expect(await audits('file.expiration.applied')).toBe(1)
  })

  it('applies jobs older versions wrote, including non-canonical deadlines and file.expired rows', async () => {
    const deadline = new Date('2030-01-01T10:00:00.000Z')
    const shifted = await file({
      expiresAt: '2030-01-01T12:00+02:00',
      expiryAction: 'SET_PRIVATE',
    })
    await job(shifted.id, deadline, 'SET_PRIVATE')
    const withoutOptions = await file()
    await prisma.event.create({
      data: {
        type: 'file.expired',
        status: 'PENDING',
        scheduledAt: deadline,
        payload: {
          fileId: withoutOptions.id,
          userId: owner,
          fileName: withoutOptions.name,
          filePath: '',
          size: 0,
          action: 'DELETE',
        },
      },
    })
    at(deadline.getTime() + 1000)
    await expiry.processDueExpirations()
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: shifted.id } }))
        .visibility
    ).toBe('PRIVATE')
    expect(
      await prisma.file.findUnique({ where: { id: withoutOptions.id } })
    ).toBeNull()
    expect(await prisma.event.count({ where: { status: 'COMPLETED' } })).toBe(2)
    expect(await audits('file.expiration.applied')).toBe(2)
    expect(await audits('event.completed')).toBe(2)
  })

  it('applies each due job once when two pollers run together', async () => {
    const deadline = new Date('2030-01-01T10:00:00.000Z')
    for (let index = 0; index < 8; index++) {
      const row = await file({
        expiresAt: deadline.toISOString(),
        expiryAction: 'SET_PRIVATE',
      })
      await job(row.id, deadline, 'SET_PRIVATE')
    }
    at(deadline.getTime() + 1000)
    await Promise.all([
      expiry.processDueExpirations(),
      expiry.processDueExpirations(),
    ])
    expect(await prisma.file.count({ where: { visibility: 'PRIVATE' } })).toBe(
      8
    )
    expect(await audits('file.expiration.applied')).toBe(8)
    expect(await audits('event.completed')).toBe(8)
    expect(await prisma.event.count({ where: { status: 'COMPLETED' } })).toBe(8)
  })

  it('retries a failed job after 1, 5 and 30 minutes, then marks it failed', async () => {
    const deadline = new Date('2030-01-01T10:00:00.000Z')
    const row = await file({ expiresAt: deadline.toISOString() })
    const { id } = await job(row.id, deadline, 'ARCHIVE')
    let now = deadline.getTime() + 1000
    const poll = async (advance: number) => {
      now += advance
      at(now)
      await expiry.processDueExpirations()
      return prisma.event.findUniqueOrThrow({ where: { id } })
    }
    expect(await poll(0)).toMatchObject({
      status: 'PENDING',
      retryCount: 1,
      error: 'Invalid file expiration action.',
    })
    for (const [wait, retryCount] of [
      [minute, 2],
      [5 * minute, 3],
    ]) {
      expect(await poll(wait - 1000)).toMatchObject({
        retryCount: retryCount - 1,
      })
      expect(await poll(1000)).toMatchObject({ status: 'PENDING', retryCount })
    }
    expect(await poll(30 * minute - 1000)).toMatchObject({ status: 'PENDING' })
    const failed = await poll(1000)
    expect(failed).toMatchObject({ status: 'FAILED', retryCount: 3 })
    expect(failed.failedAt).toEqual(new Date(now))
    expect(await poll(24 * 60 * minute)).toMatchObject({ status: 'FAILED' })
    expect(
      (await prisma.auditEvent.findMany({ where: { action: 'event.failed' } }))
        .map((event) => (event.details as { retry: boolean }).retry)
        .sort()
    ).toEqual([false, true, true, true])
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: row.id } }))
        .visibility
    ).toBe('PUBLIC')
    expect(await expiry.getFilesExpirationInfo([row.id])).toEqual(new Map())
  })

  it('reclaims a job a stopped process left claimed after 5 minutes', async () => {
    const deadline = new Date('2030-01-01T10:00:00.000Z')
    const row = await file({
      expiresAt: deadline.toISOString(),
      expiryAction: 'SET_PRIVATE',
    })
    const claimedAt = new Date(deadline.getTime() + 1000)
    const { id } = await job(row.id, deadline, 'SET_PRIVATE', {
      status: 'PROCESSING',
      updatedAt: claimedAt,
    })
    at(claimedAt.getTime() + 5 * minute - 1000)
    await expiry.processDueExpirations()
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id } })
    ).toMatchObject({ status: 'PROCESSING' })
    at(claimedAt.getTime() + 5 * minute)
    await expiry.processDueExpirations()
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id } })
    ).toMatchObject({ status: 'COMPLETED' })
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: row.id } }))
        .visibility
    ).toBe('PRIVATE')
  })

  it('answers 404 for a file that is gone by the time its owner’s row is locked', async () => {
    const row = await file()
    await prisma.file.delete({ where: { id: row.id } })
    const actor = { id: owner, permissions: ['files.delete'] }
    const expiresAt = new Date(Date.now() + 60 * minute).toISOString()
    await expect(
      expiry.scheduleFileExpiration(actor, row.id, { expiresAt })
    ).rejects.toMatchObject({ status: 404, message: 'File not found' })
    await expect(
      expiry.cancelFileExpiration(owner, row.id)
    ).rejects.toMatchObject({ status: 404, message: 'File not found' })
    expect(await prisma.event.count()).toBe(0)
  })

  it('leaves a file alone when its owner cancels while a poller holds the job', async () => {
    const deadline = new Date(Date.now() + 60 * minute)
    const row = await file({ expiryAction: 'DELETE' })
    await expiry.scheduleFileExpiration(
      { id: owner, permissions: ['files.delete'] },
      row.id,
      { expiresAt: deadline.toISOString() }
    )
    expect((await expiry.getFilesExpirationInfo([row.id])).get(row.id)).toEqual(
      { expiresAt: deadline, action: 'DELETE' }
    )
    const claimed = await prisma.event.update({
      where: { id: (await prisma.event.findFirstOrThrow()).id },
      data: { status: 'PROCESSING' },
    })
    expect(await expiry.cancelFileExpiration(owner, row.id)).toBe(true)
    await expiry.applyFileExpiration(claimed)
    expect(
      await prisma.file.findUnique({ where: { id: row.id } })
    ).not.toBeNull()
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: row.id } }))
        .uploadOptions
    ).toEqual({ expiryAction: 'DELETE', expiresAt: null })
    expect(await expiry.getFilesExpirationInfo([row.id])).toEqual(new Map())
    expect(await audits('file.expiration.applied')).toBe(0)
  })

  it('does not undo a later visibility change when a job is delivered again', async () => {
    const deadline = new Date('2030-01-01T10:00:00.000Z')
    const row = await file({
      expiresAt: deadline.toISOString(),
      expiryAction: 'SET_PRIVATE',
    })
    const { id } = await job(row.id, deadline, 'SET_PRIVATE')
    at(deadline.getTime() + 1000)
    await expiry.processDueExpirations()
    await prisma.file.update({
      where: { id: row.id },
      data: { visibility: 'PUBLIC' },
    })
    // An older version overwrote the status of a job it had read earlier.
    const redelivered = await prisma.event.update({
      where: { id },
      data: { status: 'PROCESSING' },
    })
    await expiry.applyFileExpiration(redelivered)
    expect(
      (await prisma.file.findUniqueOrThrow({ where: { id: row.id } }))
        .visibility
    ).toBe('PUBLIC')
    expect(await audits('file.expiration.applied')).toBe(1)
  })

  it('deletes finished jobs 30 days after they finish and keeps everything else', async () => {
    const now = new Date('2030-03-01T00:00:00.000Z')
    const old = new Date(now.getTime() - 30 * 24 * 60 * minute - 1000)
    const recent = new Date(now.getTime() - 29 * 24 * 60 * minute)
    const row = await file()
    const kept = [
      await job(row.id, old, 'DELETE', {
        status: 'COMPLETED',
        updatedAt: recent,
      }),
      await job(row.id, old, 'DELETE', { status: 'SCHEDULED', updatedAt: old }),
      await job(row.id, old, 'DELETE', {
        type: 'some.other-event',
        status: 'COMPLETED',
        updatedAt: old,
      }),
    ]
    for (const status of ['COMPLETED', 'FAILED'] as const)
      await job(row.id, old, 'DELETE', { status, updatedAt: old })
    at(now)
    expect(await expiry.pruneFinishedExpirations()).toBe(false)
    expect(
      (await prisma.event.findMany()).map((event) => event.id).sort()
    ).toEqual(kept.map((event) => event.id).sort())
  })
})
