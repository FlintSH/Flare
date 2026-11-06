import { ExpiryAction } from '@/types/events'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import {
  applyFileExpiration,
  getFilesExpirationInfo,
  processDueExpirations,
} from '@/lib/files/expiry'
import { EXPIRY_EFFECTS, actionPermissions } from '@/lib/permissions/actions'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import type { StorageProvider } from '@/lib/storage'
import { finalizeUpload } from '@/lib/uploads/finalize'
import { mergeUploadOptions } from '@/lib/uploads/schema'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  transaction: vi.fn(),
  findDue: vi.fn(),
  updateEvents: vi.fn(),
  storageDelete: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    config: { findUnique: vi.fn() },
    role: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    file: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    event: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    vaultFolder: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/audit', () => ({
  recordAudit: mocks.recordAudit,
  setAuditTarget: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    event: { findMany: mocks.findDue, updateMany: mocks.updateEvents },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ deleteFile: mocks.storageDelete }),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
  loggers: { files: { error: vi.fn() } },
}))
vi.mock('@/lib/tags/service', () => ({
  applyProfileTags: vi.fn(),
  applyAutomaticTags: vi.fn(),
}))
vi.mock('@/lib/config', () => ({
  readConfig: async () => ({
    settings: {
      general: {
        storage: {
          maxUploadSize: { value: 10, unit: 'MB' },
          quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
        },
      },
    },
  }),
}))
vi.mock('@/lib/security/file-validation', () => ({
  validateFileType: async () => ({ valid: true }),
}))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueFileReady: vi.fn() }))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: vi.fn() } }))

const deadline = new Date('2099-10-06T15:30:00.000Z')
const file = {
  id: 'file-1',
  name: 'receipt.pdf',
  userId: 'owner-1',
  path: 'uploads/owner-1/receipt.pdf',
  size: 2,
  uploadOptions: {
    expiresAt: deadline.toISOString(),
    expiryAction: 'SET_PRIVATE',
    shareStyle: 'minimal',
  } as Record<string, unknown> | null,
}
const job = (action: string = ExpiryAction.SET_PRIVATE) => ({
  id: 'event-1',
  type: 'file.schedule-expiration',
  payload: { fileId: 'file-1', userId: 'owner-1', action },
  status: 'SCHEDULED' as const,
  priority: 0,
  scheduledAt: deadline,
  createdAt: new Date('2099-10-01T00:00:00.000Z'),
  updatedAt: new Date('2099-10-01T00:00:00.000Z'),
  processedAt: null,
  failedAt: null,
  retryCount: 0,
  maxRetries: 3,
  error: null,
  metadata: null,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx))
  mocks.tx.event.findUnique.mockResolvedValue({
    ...job(),
    status: 'PROCESSING',
  })
  mocks.tx.file.findUnique.mockResolvedValue(structuredClone(file))
})
afterEach(() => vi.useRealTimers())

describe('applying a due expiration', () => {
  it.each([
    '2099-10-06T15:30:00Z',
    '2099-10-06T15:30Z',
    '2099-10-06T17:30:00+02:00',
    '2099-10-06T17:30+0200',
  ])(
    'applies a file whose upload recorded the deadline as %s',
    async (recorded) => {
      mocks.tx.file.findUnique.mockResolvedValue({
        ...structuredClone(file),
        uploadOptions: { ...file.uploadOptions, expiresAt: recorded },
      })
      await applyFileExpiration(job())
      expect(mocks.tx.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: {
          visibility: 'PRIVATE',
          uploadOptions: {
            ...file.uploadOptions,
            expiresAt: recorded,
            lastAppliedExpiryEvent: 'event-1',
          },
        },
      })
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file.expiration.applied' })
      )
      expect(mocks.tx.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status: 'COMPLETED', processedAt: expect.any(Date) },
      })
    }
  )

  it('applies files uploaded before upload options were recorded', async () => {
    mocks.tx.file.findUnique.mockResolvedValue({
      ...structuredClone(file),
      uploadOptions: null,
    })
    await applyFileExpiration(job(ExpiryAction.DELETE))
    expect(mocks.storageDelete).toHaveBeenCalledWith(file.path)
    expect(mocks.tx.file.delete).toHaveBeenCalledWith({
      where: { id: 'file-1' },
    })
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { storageUsed: { decrement: 2 } },
    })
  })

  it.each([
    ['was cancelled', { uploadOptions: { expiresAt: null } }],
    [
      'was moved to another time',
      { uploadOptions: { expiresAt: '2099-10-06T15:31:00.000Z' } },
    ],
    [
      'was already applied',
      {
        uploadOptions: {
          expiresAt: deadline.toISOString(),
          lastAppliedExpiryEvent: 'event-1',
        },
      },
    ],
    ['belongs to another account', { userId: 'someone-else' }],
  ])(
    'completes without changing a file whose expiry %s',
    async (_case, change) => {
      mocks.tx.file.findUnique.mockResolvedValue({
        ...structuredClone(file),
        ...change,
      })
      await applyFileExpiration(job(ExpiryAction.DELETE))
      expect(mocks.storageDelete).not.toHaveBeenCalled()
      expect(mocks.tx.file.delete).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
      expect(mocks.tx.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      )
    }
  )
})

describe('pending expirations for a list of files', () => {
  it('names each file’s earliest pending time and what it does then', async () => {
    const soon = new Date('2030-01-01T10:00:00Z')
    const later = new Date('2030-02-01T10:00:00Z')
    // Earliest first, as the query orders them.
    mocks.findDue.mockResolvedValue([
      { payload: { fileId: 'a', action: 'SET_PRIVATE' }, scheduledAt: soon },
      { payload: { fileId: 'a', action: 'DELETE' }, scheduledAt: later },
      { payload: { fileId: 'b', action: 'DELETE' }, scheduledAt: later },
      { payload: { fileId: 'c' }, scheduledAt: later },
      { payload: { fileId: 'd', action: 'DELETE' }, scheduledAt: null },
    ])
    expect(await getFilesExpirationInfo(['a', 'b', 'c', 'd'])).toEqual(
      new Map([
        ['a', { expiresAt: soon, action: ExpiryAction.SET_PRIVATE }],
        ['b', { expiresAt: later, action: ExpiryAction.DELETE }],
        ['c', { expiresAt: later, action: ExpiryAction.DELETE }],
        ['d', null],
      ])
    )
  })
})

describe('the expiry poller', () => {
  it('claims each due job against the row it read, then applies it once', async () => {
    mocks.findDue.mockResolvedValue([job()])
    mocks.updateEvents.mockResolvedValue({ count: 1 })
    await processDueExpirations()
    expect(mocks.updateEvents).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        status: 'SCHEDULED',
        updatedAt: job().updatedAt,
      },
      data: { status: 'PROCESSING', updatedAt: expect.any(Date) },
    })
    expect(mocks.tx.file.update).toHaveBeenCalledTimes(1)
    expect(mocks.recordAudit).toHaveBeenLastCalledWith({
      action: 'event.completed',
      category: 'system',
      outcome: 'success',
      actorName: 'System',
      targetType: 'Event',
      targetId: 'event-1',
      details: { eventType: 'file.schedule-expiration' },
    })
  })

  it('leaves a job another process claimed first', async () => {
    mocks.findDue.mockResolvedValue([job()])
    mocks.updateEvents.mockResolvedValue({ count: 0 })
    await processDueExpirations()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it.each([
    [0, true, { status: 'PENDING', retryCount: { increment: 1 } }],
    [2, true, { status: 'PENDING', retryCount: { increment: 1 } }],
    [3, false, { status: 'FAILED' }],
  ])(
    'records a failure after %i earlier failures (retry: %s)',
    async (retryCount, retry, change) => {
      mocks.findDue.mockResolvedValue([{ ...job(), retryCount }])
      mocks.updateEvents.mockResolvedValue({ count: 1 })
      mocks.transaction.mockRejectedValue(new Error('Database unavailable'))
      await processDueExpirations()
      expect(mocks.updateEvents).toHaveBeenLastCalledWith({
        where: { id: 'event-1', status: 'PROCESSING' },
        data: {
          ...change,
          failedAt: expect.any(Date),
          error: 'Database unavailable',
        },
      })
      expect(mocks.recordAudit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: 'event.failed',
          outcome: 'failure',
          details: { eventType: 'file.schedule-expiration', retry },
        })
      )
    }
  )

  it('waits 1, 5 and 30 minutes before retrying and reclaims abandoned claims after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2099-10-06T16:00:00.000Z'))
    mocks.findDue.mockResolvedValue([])
    await processDueExpirations()
    const { where, orderBy, take } = mocks.findDue.mock.calls[0][0]
    expect(where.type).toEqual({
      in: ['file.schedule-expiration', 'file.expired'],
    })
    const [waiting, abandoned] = where.OR
    expect(waiting.status).toEqual({ in: ['SCHEDULED', 'PENDING'] })
    expect(waiting.AND[1].OR).toEqual([
      { failedAt: null },
      {
        retryCount: { lte: 1 },
        failedAt: { lte: new Date('2099-10-06T15:59:00.000Z') },
      },
      {
        retryCount: 2,
        failedAt: { lte: new Date('2099-10-06T15:55:00.000Z') },
      },
      {
        retryCount: { gte: 3 },
        failedAt: { lte: new Date('2099-10-06T15:30:00.000Z') },
      },
    ])
    expect(abandoned).toEqual({
      status: 'PROCESSING',
      updatedAt: { lte: new Date('2099-10-06T15:55:00.000Z') },
    })
    expect(orderBy).toEqual([{ scheduledAt: 'asc' }, { id: 'asc' }])
    expect(take).toBe(10)
  })
})

describe('upload-time expiration', () => {
  const user: AuthenticatedUser = {
    id: 'owner-1',
    storageUsed: 0,
    urlId: 'owner',
    vanityId: null,
    roles: [],
    permissions: [...DEFAULT_PERMISSIONS],
    randomizeFileUrls: false,
    credential: 'session',
  }
  const upload = (expiryAction: 'DELETE' | 'SET_PRIVATE') => ({
    user,
    storage: {
      kind: 'local',
      target: { provider: 'local' },
      getFileStream: async () => Readable.from([Buffer.from('hi')]),
    } as unknown as StorageProvider,
    filePath: file.path,
    urlPath: '/owner/receipt.pdf',
    displayName: file.name,
    mimeType: 'text/plain',
    size: 2,
    // A valid offset form that earlier versions stored verbatim.
    options: mergeUploadOptions(
      {},
      {},
      { expiresAt: '2099-10-06T17:30+0200', expiryAction }
    ),
  })
  const role = (permissions: readonly string[]) => ({
    id: 'everyone',
    name: 'Everyone',
    position: 0,
    systemKey: 'everyone',
    permissions: [...permissions],
  })

  beforeEach(() => {
    mocks.tx.user.findUnique.mockResolvedValue({ ...user, roles: [] })
    mocks.tx.role.findUnique.mockResolvedValue(role(DEFAULT_PERMISSIONS))
    mocks.tx.file.findFirst.mockResolvedValue(null)
    mocks.tx.file.findUnique.mockResolvedValue(null)
    mocks.tx.file.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'file-1',
    }))
  })

  it('records the deadline as one UTC instant on the file, the job and the audit', async () => {
    await finalizeUpload(upload('DELETE'))
    expect(mocks.tx.file.create.mock.calls[0][0].data.uploadOptions).toEqual(
      expect.objectContaining({
        expiresAt: '2099-10-06T15:30:00.000Z',
        expiryAction: 'DELETE',
      })
    )
    expect(mocks.tx.event.create).toHaveBeenCalledWith({
      data: {
        type: 'file.schedule-expiration',
        status: 'SCHEDULED',
        scheduledAt: deadline,
        payload: {
          fileId: 'file-1',
          userId: 'owner-1',
          fileName: 'receipt.pdf',
          expiresAt: '2099-10-06T15:30:00.000Z',
          action: 'DELETE',
        },
      },
    })
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'file.expiration.scheduled',
      category: 'files',
      targetType: 'file',
      targetId: 'file-1',
      targetName: 'receipt.pdf',
      details: {
        ownerId: 'owner-1',
        expiresAt: deadline,
        expiryAction: 'DELETE',
      },
    })
  })

  it.each(['DELETE', 'SET_PRIVATE'] as const)(
    'rejects a %s expiration when the role lacks its permission',
    async (action) => {
      const needed = actionPermissions(EXPIRY_EFFECTS[action as ExpiryAction])
      mocks.tx.role.findUnique.mockResolvedValue(
        role(
          DEFAULT_PERMISSIONS.filter(
            (permission) => !needed.includes(permission)
          )
        )
      )
      await expect(finalizeUpload(upload(action))).rejects.toMatchObject({
        status: 403,
        message:
          'Your role does not allow the selected expiration action. Disable expiration or ask for the required permission.',
      })
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
      expect(mocks.tx.event.create).not.toHaveBeenCalled()
    }
  )
})
