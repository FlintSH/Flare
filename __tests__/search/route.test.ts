import { POST } from '@/app/api/search/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  file: { findMany: vi.fn() },
  shortenedUrl: { findMany: vi.fn() },
  vaultFolder: { findMany: vi.fn() },
  expiry: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: mocks.file,
    shortenedUrl: mocks.shortenedUrl,
    vaultFolder: mocks.vaultFolder,
  },
}))
vi.mock('@/lib/files/expiry', () => ({
  getFilesExpirationInfo: mocks.expiry,
}))

const find = (q: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://flare.test/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://flare.test',
        ...headers,
      },
      body: JSON.stringify({ q }),
    })
  )

let account = 0
beforeEach(() => {
  vi.resetAllMocks()
  // A new account each test, so the per-account limit doesn't carry over.
  account += 1
  mocks.session.mockResolvedValue({
    user: {
      id: `user-${account}`,
      permissions: ['files.read', 'links.read'],
    },
  })
  mocks.file.findMany.mockResolvedValue([])
  mocks.shortenedUrl.findMany.mockResolvedValue([])
  mocks.vaultFolder.findMany.mockResolvedValue([])
  mocks.expiry.mockResolvedValue(new Map())
})

describe('POST /api/search', () => {
  it('needs a signed-in browser session', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await find('canyon')).status).toBe(401)
  })

  it('searches only the caller’s own content, a few of each', async () => {
    const response = await find('canyon')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { files: [], links: [], folders: [] },
    })
    for (const table of [mocks.file, mocks.shortenedUrl, mocks.vaultFolder])
      expect(table.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: `user-${account}` }),
          take: 5,
        })
      )
  })

  it('lists name matches first and reads image text only from three characters', async () => {
    await find('ab')
    expect(mocks.file.findMany).toHaveBeenCalledTimes(1)
    expect(mocks.file.findMany.mock.calls[0][0].where.name).toEqual({
      contains: 'ab',
      mode: 'insensitive',
    })
    mocks.file.findMany.mockReset()
    mocks.file.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await find('abc')
    expect(mocks.file.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.file.findMany.mock.calls[1][0].where.ocrText).toEqual({
      contains: 'abc',
      mode: 'insensitive',
    })
  })

  it('leaves out what the role can’t list', async () => {
    mocks.session.mockResolvedValue({
      user: { id: `user-${account}`, permissions: ['files.read'] },
    })
    const body = await (await find('canyon')).json()
    expect(body.data.links).toBeNull()
    expect(mocks.shortenedUrl.findMany).not.toHaveBeenCalled()
  })

  it.each([['a'], ['x'.repeat(201)], [42]])('refuses %j', async (q) => {
    expect((await find(q)).status).toBe(400)
    expect(mocks.file.findMany).not.toHaveBeenCalled()
  })

  it('refuses another site', async () => {
    const response = await find('canyon', { Origin: 'https://evil.test' })
    expect(response.status).toBe(403)
  })

  it('limits each account on its own', async () => {
    let last = 200
    for (let n = 0; n < 121; n++) last = (await find('canyon')).status
    expect(last).toBe(429)
  })
})
