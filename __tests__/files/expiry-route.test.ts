import { DELETE, GET, POST } from '@/app/api/files/[id]/expiry/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  findFile: vi.fn(),
  findEvents: vi.fn(),
  createEvent: vi.fn(),
  updateFile: vi.fn(),
  deleteEvents: vi.fn(),
}))
vi.mock('@/lib/http/access', () => ({ requireAccount: mocks.requireAccount }))
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => {
  const tx = {
    $queryRaw: vi.fn(),
    file: {
      findFirst: mocks.findFile,
      update: mocks.updateFile,
      updateMany: mocks.updateFile,
    },
    event: {
      create: mocks.createEvent,
      deleteMany: mocks.deleteEvents,
      updateMany: async () => ({ count: 0 }),
    },
  }
  return {
    prisma: {
      ...tx,
      event: { ...tx.event, findMany: mocks.findEvents },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    },
  }
})

const context = { params: Promise.resolve({ id: 'file-1' }) }
const deadline = '2099-10-06T15:30:00.000Z'
const url = 'https://flare.example/api/files/file-1/expiry'
const schedule = (body: unknown) =>
  POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context
  )
const cancel = () => DELETE(new Request(url, { method: 'DELETE' }), context)
const owner = (permissions: readonly string[] = DEFAULT_PERMISSIONS) => ({
  id: 'owner-1',
  permissions: [...permissions],
})
const file = {
  id: 'file-1',
  name: 'notes.txt',
  userId: 'owner-1',
  uploadOptions: { visibility: 'PUBLIC' },
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAccount.mockResolvedValue(owner())
  mocks.findFile.mockResolvedValue(file)
  mocks.findEvents.mockResolvedValue([
    { payload: { fileId: 'file-1' }, scheduledAt: new Date(deadline) },
  ])
  mocks.deleteEvents.mockResolvedValue({ count: 1 })
})

describe('file expiry route', () => {
  it('reads the file’s earliest pending expiry', async () => {
    const response = await GET(new Request(url), context)
    expect(await response.json()).toEqual({
      success: true,
      data: { expiresAt: deadline },
    })
    expect(mocks.findFile).toHaveBeenCalledWith({
      where: { id: 'file-1', userId: 'owner-1' },
    })
    mocks.findEvents.mockResolvedValue([])
    const empty = await GET(new Request(url), context)
    expect(await empty.json()).toEqual({
      success: true,
      data: { expiresAt: null },
    })
  })

  it.each([
    ['DELETE', 'files.delete'],
    ['SET_PRIVATE', 'files.share'],
  ])('schedules %s only with %s', async (action, permission) => {
    const response = await schedule({ expiresAt: deadline, action })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        message: 'File expiration scheduled successfully',
        expiresAt: deadline,
      },
    })
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduledAt: new Date(deadline),
        payload: expect.objectContaining({ fileId: 'file-1', action }),
      }),
    })
    mocks.createEvent.mockClear()
    mocks.requireAccount.mockResolvedValue(
      owner(DEFAULT_PERMISSIONS.filter((granted) => granted !== permission))
    )
    const denied = await schedule({ expiresAt: deadline, action })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({
      success: false,
      error: 'You do not have permission for this expiration action.',
    })
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('defaults to deletion and rejects an unknown action', async () => {
    await schedule({ expiresAt: deadline })
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ action: 'DELETE' }),
      }),
    })
    const invalid = await schedule({ expiresAt: deadline, action: 'ARCHIVE' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      error: 'Invalid expiration action',
    })
  })

  it('takes a future time only in the form uploads take', async () => {
    const answers = async (body: unknown) => {
      const response = await schedule(body)
      return [response.status, (await response.json()).error]
    }
    for (const expiresAt of [
      '2099-10-06T15:30Z',
      '2099-10-06T17:30:00+02:00',
      '2099-10-06T17:30+0200',
    ])
      expect(await answers({ expiresAt })).toEqual([200, undefined])
    expect(await answers({})).toEqual([400, 'Expiration date is required'])
    expect(await answers(null)).toEqual([400, 'Expiration date is required'])
    for (const expiresAt of [
      '2099-10-06',
      '2099-10-06T15:30:00',
      'October 6, 2099 15:30 UTC',
      4_000_000_000_000,
    ])
      expect(await answers({ expiresAt })).toEqual([
        400,
        'Invalid expiration date. Use an ISO 8601 timestamp with a timezone.',
      ])
    expect(await answers({ expiresAt: '2001-10-06T15:30:00Z' })).toEqual([
      400,
      'Invalid expiration date. Must be in the future.',
    ])
  })

  it('answers 404 for a file the requester doesn’t own, or that is gone by the time it is locked', async () => {
    mocks.findFile.mockResolvedValue(null)
    for (const response of [
      await GET(new Request(url), context),
      await schedule({ expiresAt: deadline }),
      await cancel(),
    ]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        success: false,
        error: 'File not found',
      })
    }
    expect(mocks.createEvent).not.toHaveBeenCalled()
    expect(mocks.deleteEvents).not.toHaveBeenCalled()
  })

  it('cancels only the requesting owner’s file', async () => {
    const response = await cancel()
    expect(await response.json()).toEqual({
      success: true,
      data: { message: 'File expiration cancelled', cancelled: true },
    })
    expect(mocks.findFile).toHaveBeenCalledWith({
      where: { id: 'file-1', userId: 'owner-1' },
    })
    mocks.deleteEvents.mockResolvedValue({ count: 0 })
    expect(await (await cancel()).json()).toEqual({
      success: true,
      data: { message: 'No expiration found', cancelled: false },
    })
  })
})
