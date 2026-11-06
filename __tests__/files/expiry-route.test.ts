import { DELETE, GET, POST } from '@/app/api/files/[id]/expiry/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  findFile: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@/lib/http/access', () => ({ requireAccount: mocks.requireAccount }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: mocks.findFile } },
}))
vi.mock('@/lib/files/expiry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files/expiry')>()),
  scheduleFileExpiration: mocks.schedule,
  cancelFileExpiration: mocks.cancel,
  getFilesExpirationInfo: mocks.info,
}))

const context = { params: Promise.resolve({ id: 'file-1' }) }
const deadline = '2099-10-06T15:30:00.000Z'
const schedule = (body: unknown) =>
  POST(
    new Request('https://flare.example/api/files/file-1/expiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context
  )
const owner = (permissions: readonly string[] = DEFAULT_PERMISSIONS) => ({
  id: 'owner-1',
  permissions: [...permissions],
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAccount.mockResolvedValue(owner())
  mocks.findFile.mockResolvedValue({ userId: 'owner-1' })
  mocks.info.mockResolvedValue(new Map([['file-1', new Date(deadline)]]))
  mocks.cancel.mockResolvedValue(true)
})

describe('file expiry route', () => {
  it('reads the file’s earliest pending expiry', async () => {
    const response = await GET(
      new Request('https://flare.example/api/files/file-1/expiry'),
      context
    )
    expect(await response.json()).toEqual({
      success: true,
      data: { expiresAt: deadline },
    })
    expect(mocks.info).toHaveBeenCalledWith(['file-1'])
    mocks.info.mockResolvedValue(new Map())
    const empty = await GET(
      new Request('https://flare.example/api/files/file-1/expiry'),
      context
    )
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
    expect(mocks.schedule).toHaveBeenCalledWith(
      'file-1',
      'owner-1',
      new Date(deadline),
      action
    )
    mocks.schedule.mockClear()
    mocks.requireAccount.mockResolvedValue(
      owner(DEFAULT_PERMISSIONS.filter((granted) => granted !== permission))
    )
    const denied = await schedule({ expiresAt: deadline, action })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({
      error: 'You do not have permission for this expiration action.',
    })
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it('defaults to deletion and rejects an unknown action', async () => {
    await schedule({ expiresAt: deadline })
    expect(mocks.schedule).toHaveBeenCalledWith(
      'file-1',
      'owner-1',
      new Date(deadline),
      'DELETE'
    )
    const invalid = await schedule({ expiresAt: deadline, action: 'ARCHIVE' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      error: 'Invalid expiration action',
    })
  })

  it('cancels only the requesting owner’s file', async () => {
    const response = await DELETE(
      new Request('https://flare.example/api/files/file-1/expiry', {
        method: 'DELETE',
      }),
      context
    )
    expect(await response.json()).toEqual({
      success: true,
      data: { message: 'File expiration cancelled', cancelled: true },
    })
    expect(mocks.cancel).toHaveBeenCalledWith('file-1', 'owner-1')
    mocks.findFile.mockResolvedValue({ userId: 'someone-else' })
    const foreign = await DELETE(
      new Request('https://flare.example/api/files/file-1/expiry', {
        method: 'DELETE',
      }),
      context
    )
    expect(foreign.status).toBe(404)
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
  })
})
