import { type BaseEvent, EventStatus, ExpiryAction } from '@/types/events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelFileExpiration,
  registerFileExpiryHandlers,
  scheduleFileExpiration,
} from '@/lib/events/handlers/file-expiry'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  on: vi.fn(),
  findFile: vi.fn(),
  updateFile: vi.fn(),
  deleteFile: vi.fn(),
  findEvent: vi.fn(),
  deleteEvents: vi.fn(),
  updateEvents: vi.fn(),
  createEvent: vi.fn(),
  transaction: vi.fn(),
  storageDelete: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }))
vi.mock('@/lib/events', () => ({ events: { on: mocks.on } }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ deleteFile: mocks.storageDelete }),
}))
vi.mock('@/lib/logger', () => ({
  loggers: { events: { getChildLogger: () => ({ info: vi.fn() }) } },
}))

const expiresAt = new Date('2099-10-06T15:30:00Z')
const file = {
  id: 'file-1',
  name: 'receipt.pdf',
  userId: 'owner-1',
  path: 'private/path',
  size: 12,
  uploadOptions: {
    expiresAt: expiresAt.toISOString(),
    expiryAction: ExpiryAction.DELETE,
    password: 'private-password',
  },
}
const event: BaseEvent = {
  id: 'event-1',
  type: 'file.schedule-expiration',
  payload: {},
  status: EventStatus.PROCESSING,
  priority: 0,
  scheduledAt: expiresAt,
  createdAt: new Date(),
  updatedAt: new Date(),
  retryCount: 0,
  maxRetries: 3,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.findFile.mockResolvedValue(structuredClone(file))
  mocks.findEvent.mockResolvedValue(event)
  mocks.deleteEvents.mockResolvedValue({ count: 1 })
  mocks.updateEvents.mockResolvedValue({ count: 0 })
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      file: {
        findFirst: mocks.findFile,
        findUnique: mocks.findFile,
        update: mocks.updateFile,
        updateMany: mocks.updateFile,
        delete: mocks.deleteFile,
      },
      user: { update: vi.fn() },
      event: {
        findUnique: mocks.findEvent,
        deleteMany: mocks.deleteEvents,
        updateMany: mocks.updateEvents,
        create: mocks.createEvent,
      },
    })
  )
})

describe('file expiration audit actions', () => {
  it('records the actual filename, deadline and action when scheduling without copying upload options', async () => {
    await scheduleFileExpiration(
      'file-1',
      'owner-1',
      'stale-name.pdf',
      expiresAt,
      ExpiryAction.SET_PRIVATE
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'file.expiration.scheduled',
      category: 'files',
      targetType: 'file',
      targetId: 'file-1',
      targetName: 'receipt.pdf',
      details: {
        ownerId: 'owner-1',
        expiresAt,
        expiryAction: ExpiryAction.SET_PRIVATE,
      },
    })
    expect(JSON.stringify(mocks.recordAudit.mock.calls)).not.toMatch(
      /stale-name|private-password|private\/path/
    )
  })

  it('records actual cancellation and does not claim another cancellation after no schedules remain', async () => {
    expect(await cancelFileExpiration('file-1')).toBe(true)
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'file.expiration.cancelled',
      category: 'files',
      targetType: 'file',
      targetId: 'file-1',
      targetName: 'receipt.pdf',
      details: {
        ownerId: 'owner-1',
        count: 1,
        expiresAt,
        expiryAction: ExpiryAction.DELETE,
      },
    })
    mocks.recordAudit.mockClear()
    mocks.deleteEvents.mockResolvedValue({ count: 0 })
    expect(await cancelFileExpiration('file-1')).toBe(false)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it.each([ExpiryAction.DELETE, ExpiryAction.SET_PRIVATE])(
    'records autonomous applied %s only after the mutation succeeds',
    async (action) => {
      await registerFileExpiryHandlers()
      const handler = mocks.on.mock.calls.find(
        ([type]) => type === 'file.schedule-expiration'
      )![2]
      await handler({ fileId: 'file-1', userId: 'owner-1', action }, event)
      expect(mocks.recordAudit).toHaveBeenCalledWith({
        action: 'file.expiration.applied',
        category: 'files',
        actorId: null,
        actorName: 'System',
        targetType: 'file',
        targetId: 'file-1',
        targetName: 'receipt.pdf',
        details: {
          ownerId: 'owner-1',
          eventId: 'event-1',
          expiresAt,
          expiryAction: action,
        },
      })
      expect(JSON.stringify(mocks.recordAudit.mock.calls)).not.toMatch(
        /private-password|private\/path/
      )
    }
  )

  it('does not claim an applied expiration when storage deletion fails or a stale worker observes cancellation', async () => {
    await registerFileExpiryHandlers()
    const handler = mocks.on.mock.calls.find(
      ([type]) => type === 'file.schedule-expiration'
    )![2]
    mocks.storageDelete.mockRejectedValue(new Error('Storage failure'))
    await expect(
      handler(
        { fileId: 'file-1', userId: 'owner-1', action: ExpiryAction.DELETE },
        event
      )
    ).rejects.toThrow('Storage failure')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    mocks.findEvent.mockResolvedValue({ ...event, status: 'COMPLETED' })
    await handler(
      { fileId: 'file-1', userId: 'owner-1', action: ExpiryAction.DELETE },
      event
    )
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
