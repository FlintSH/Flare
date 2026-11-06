import { ExpiryAction } from '@/types/events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyFileExpiration,
  cancelFileExpiration,
  scheduleFileExpiration,
} from '@/lib/files/expiry'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  findFile: vi.fn(),
  updateFile: vi.fn(),
  deleteFile: vi.fn(),
  findEvent: vi.fn(),
  deleteEvents: vi.fn(),
  updateEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  transaction: vi.fn(),
  storageDelete: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ deleteFile: mocks.storageDelete }),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
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
const event = {
  id: 'event-1',
  type: 'file.schedule-expiration',
  status: 'PROCESSING',
  scheduledAt: expiresAt,
}
const job = (action: ExpiryAction) => ({
  id: 'event-1',
  payload: { fileId: 'file-1', userId: 'owner-1', action },
})

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
        update: mocks.updateEvent,
      },
    })
  )
})

describe('file expiration audit actions', () => {
  it('records the locked file name, deadline, action and owner when scheduling without copying upload options', async () => {
    await scheduleFileExpiration(
      { id: 'owner-1', permissions: ['files.share'] },
      'file-1',
      { expiresAt: expiresAt.toISOString(), action: ExpiryAction.SET_PRIVATE }
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
      /private-password|private\/path/
    )
  })

  it('records actual cancellation and does not claim another cancellation after no schedules remain', async () => {
    expect(await cancelFileExpiration('owner-1', 'file-1')).toBe(true)
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
    expect(await cancelFileExpiration('owner-1', 'file-1')).toBe(false)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it.each([ExpiryAction.DELETE, ExpiryAction.SET_PRIVATE])(
    'records autonomous applied %s only after the mutation succeeds',
    async (action) => {
      await applyFileExpiration(job(action))
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
    mocks.storageDelete.mockRejectedValue(new Error('Storage failure'))
    await expect(applyFileExpiration(job(ExpiryAction.DELETE))).rejects.toThrow(
      'Storage failure'
    )
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    mocks.findEvent.mockResolvedValue({ ...event, status: 'COMPLETED' })
    await applyFileExpiration(job(ExpiryAction.DELETE))
    expect(mocks.recordAudit).not.toHaveBeenCalled()
    expect(mocks.deleteFile).not.toHaveBeenCalled()
  })
})
