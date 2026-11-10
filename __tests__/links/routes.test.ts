import { GET as follow } from '@/app/(shorturl)/u/[shortCode]/route'
import { DELETE as deleteOwn } from '@/app/api/urls/[id]/route'
import { POST as create, GET as listOwn } from '@/app/api/urls/route'
import { DELETE as moderate } from '@/app/api/users/[id]/urls/[urlId]/route'
import { GET as listAccount } from '@/app/api/users/[id]/urls/route'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditInput, configureAuditWriter } from '@/lib/audit'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  session: vi.fn(),
  shortenedUrl: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}))
vi.mock('@/lib/auth/api-auth', () => ({
  getAuthenticatedUser: mocks.account,
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { shortenedUrl: mocks.shortenedUrl },
}))

const links = mocks.shortenedUrl
const stored = {
  id: 'cm_link',
  shortCode: 'aB3_dE',
  targetUrl: 'https://example.com/a/long/path',
  clicks: 0,
  createdAt: new Date('2026-09-20T12:00:00.000Z'),
  userId: 'owner',
}
const sent = { ...stored, createdAt: '2026-09-20T12:00:00.000Z' }
const events: Partial<AuditInput>[] = []

const json = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const params = <T>(value: T) => ({ params: Promise.resolve(value) })

beforeEach(() => {
  vi.resetAllMocks()
  events.length = 0
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
  mocks.account.mockResolvedValue({
    id: 'owner',
    permissions: ['links.read', 'links.create', 'links.delete'],
    credential: 'session',
  })
  mocks.session.mockResolvedValue({
    user: { id: 'moderator', permissions: ['content.read', 'content.delete'] },
  })
})

describe('owner short-link API', () => {
  it('creates a link and sends the stored record', async () => {
    links.create.mockResolvedValue(stored)
    const response = await create(
      json('https://flare.test/api/urls', { url: stored.targetUrl })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: sent, success: true })
  })

  it('answers a concurrent request that drew the same code instead of failing with 500', async () => {
    links.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        })
      )
      .mockResolvedValueOnce(stored)
    const response = await create(
      json('https://flare.test/api/urls', { url: stored.targetUrl })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: sent, success: true })
    expect(links.create).toHaveBeenCalledTimes(2)
  })

  it('rejects a destination that is not HTTP or HTTPS', async () => {
    const response = await create(
      json('https://flare.test/api/urls', { url: 'ftp://example.com/file' })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Only HTTP and HTTPS URLs are allowed',
    })
    expect(links.create).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a file key',
      (key: string) =>
        `https://flare.test/alexm/e_0123456789abcdefghijkl#${key}`,
    ],
    [
      'a link secret',
      (key: string) =>
        `https://flare.test/alexm/e_0123456789abcdefghijkl#p.${key}`,
    ],
    [
      'a key of a later version',
      (key: string) =>
        `https://other.example/x/e_0123456789abcdefghijkl#v2.${key}`,
    ],
  ])(
    'refuses a target that carries %s after #, stores nothing and logs no key',
    async (_name, link) => {
      // 32 bytes as base64url: the form of a Flare key (section 12.6).
      const key = Buffer.from(
        Uint8Array.from({ length: 32 }, (_, index) => 200 - index * 5)
      ).toString('base64url')
      const logged: unknown[] = []
      for (const level of ['info', 'warn', 'error'] as const)
        vi.spyOn(loggers.api, level).mockImplementation(
          (...args: unknown[]) => {
            logged.push(args)
          }
        )
      const response = await create(
        json('https://flare.test/api/urls', { url: link(key) })
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        success: false,
        error:
          'This link has an encryption key after #. A short link is stored on the server, so shortening it would give the server the key. Share the full link instead.',
      })
      expect(links.create).not.toHaveBeenCalled()
      // The refusal is recorded without the address that was refused.
      expect(JSON.stringify(events)).not.toContain(key)
      expect(JSON.stringify(logged)).not.toContain(key)
    }
  )

  it("lists the caller's links", async () => {
    links.findMany.mockResolvedValue([stored])
    const response = await listOwn(new Request('https://flare.test/api/urls'))
    expect(await response.json()).toEqual({
      data: { urls: [sent] },
      success: true,
    })
    expect(links.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner' } })
    )
  })

  it('deletes an owned link with an empty 204', async () => {
    links.findUnique.mockResolvedValue({ userId: 'owner' })
    const response = await deleteOwn(
      new Request('https://flare.test/api/urls/cm_link', { method: 'DELETE' }),
      params({ id: 'cm_link' })
    )
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it.each([
    [null, 404, 'URL not found'],
    [{ userId: 'someone-else' }, 403, 'Unauthorized'],
  ])('answers an owner lookup of %j with %i', async (found, status, error) => {
    links.findUnique.mockResolvedValue(found)
    const response = await deleteOwn(
      new Request('https://flare.test/api/urls/cm_link', {
        method: 'DELETE',
      }),
      params({ id: 'cm_link' })
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ success: false, error })
    expect(links.delete).not.toHaveBeenCalled()
  })
})

describe('moderation short-link API', () => {
  const listed = (({ userId: _owner, ...link }) => link)(stored)
  const list = (query: string) =>
    listAccount(
      new Request(`https://flare.test/api/users/member/urls${query}`),
      params({ id: 'member' })
    )

  it('keeps the list shape and the default page size', async () => {
    links.count.mockResolvedValue(1)
    links.findMany.mockResolvedValue([listed])
    const response = await list('?search=path')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      urls: [{ ...listed, createdAt: sent.createdAt }],
      pagination: { total: 1, pages: 1, page: 1, limit: 10 },
    })
    // Reading another account's links takes content.read.
    mocks.session.mockResolvedValue({
      user: { id: 'moderator', permissions: ['content.delete'] },
    })
    expect((await list('')).status).toBe(403)
  })

  it.each([
    ['?page=abc&limit=xyz', 25, { skip: 0, take: 10 }, { page: 1, limit: 10 }],
    ['?page=0&limit=-5', 25, { skip: 0, take: 10 }, { page: 1, limit: 10 }],
    [
      '?page=2&limit=1000',
      250,
      { skip: 100, take: 100 },
      { page: 2, limit: 100 },
    ],
    ['?page=40&limit=10', 25, { skip: 20, take: 10 }, { page: 3, limit: 10 }],
  ])(
    'answers %s with a page that exists, within the limits',
    async (query, total, window, pagination) => {
      links.count.mockResolvedValue(total)
      links.findMany.mockResolvedValue([])
      const response = await list(query)
      expect(response.status).toBe(200)
      expect((await response.json()).pagination).toMatchObject(pagination)
      expect(links.findMany).toHaveBeenCalledWith(
        expect.objectContaining(window)
      )
    }
  )

  it('keeps its unexpected-failure body and logs the cause', async () => {
    const logged = vi.spyOn(loggers.users, 'error').mockImplementation(() => {})
    links.count.mockRejectedValue(new Error('database unavailable'))
    const response = await list('')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal Server Error' })
    expect(logged).toHaveBeenCalledWith(
      'GET /api/users/[id]/urls failed',
      expect.any(Error)
    )
  })

  it('deletes only a link of the account in the path', async () => {
    const remove = (headers: Record<string, string> = {}) =>
      moderate(
        new Request('https://flare.test/api/users/member/urls/cm_link', {
          method: 'DELETE',
          headers,
        }),
        params({ id: 'member', urlId: 'cm_link' })
      )
    links.deleteMany.mockResolvedValue({ count: 1 })
    const deleted = await remove()
    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')
    expect(links.deleteMany).toHaveBeenCalledWith({
      where: { id: 'cm_link', userId: 'member' },
    })

    links.deleteMany.mockResolvedValue({ count: 0 })
    const missing = await remove()
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      success: false,
      error: 'URL not found',
    })

    links.deleteMany.mockClear()
    const foreign = await remove({ Origin: 'https://foreign.test' })
    expect(foreign.status).toBe(403)
    // Deleting takes content.delete; content.read is not enough.
    mocks.session.mockResolvedValue({
      user: { id: 'moderator', permissions: ['content.read'] },
    })
    expect((await remove()).status).toBe(403)
    expect(links.deleteMany).not.toHaveBeenCalled()
  })

  it('answers sign-in refusals without the envelope', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await list('')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
    expect(links.count).not.toHaveBeenCalled()
  })
})

describe('public redirect', () => {
  const open = (shortCode: string) =>
    follow(new Request(`https://flare.test/u/${shortCode}`), {
      params: Promise.resolve({ shortCode }),
    })

  it('redirects, counts the click, and names the link in the request event', async () => {
    links.findUnique.mockResolvedValue(stored)
    const response = await open('aB3_dE')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(stored.targetUrl)
    expect(links.update).toHaveBeenCalledWith({
      where: { id: 'cm_link' },
      data: { clicks: { increment: 1 } },
    })
    expect(events).toEqual([
      expect.objectContaining({
        action: 'http.get',
        outcome: 'success',
        route: '/u/[shortCode]',
        status: 307,
        targetType: 'link',
        targetId: 'cm_link',
        targetName: 'aB3_dE',
      }),
    ])
  })

  it('answers an unknown code with an empty 404', async () => {
    links.findUnique.mockResolvedValue(null)
    const response = await open('nope00')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    expect(links.update).not.toHaveBeenCalled()
  })
})
