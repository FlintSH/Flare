import { GET as follow } from '@/app/(shorturl)/u/[shortCode]/route'
import {
  DELETE as deleteOwn,
  PATCH as updateOwn,
} from '@/app/api/urls/[id]/route'
import { POST as create, GET as listOwn } from '@/app/api/urls/route'
import { DELETE as moderate } from '@/app/api/users/[id]/urls/[urlId]/route'
import { GET as listAccount } from '@/app/api/users/[id]/urls/route'
import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  session: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  shortenedUrl: {
    create: vi.fn(),
    findFirst: vi.fn(),
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
  prisma: {
    shortenedUrl: mocks.shortenedUrl,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
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

const json = (url: string, body: unknown, method = 'POST') =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const params = <T>(value: T) => ({ params: Promise.resolve(value) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((work) =>
    work({
      shortenedUrl: mocks.shortenedUrl,
      $executeRaw: mocks.executeRaw,
    })
  )
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
// A successful read is recorded after its response; keep it in its own test.
afterEach(auditSettled)

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

  it('creates a link under a chosen ending', async () => {
    links.findFirst.mockResolvedValue(null)
    links.create.mockResolvedValue({ ...stored, shortCode: 'launch' })
    const response = await create(
      json('https://flare.test/api/urls', {
        url: stored.targetUrl,
        code: ' launch ',
      })
    )
    expect(response.status).toBe(200)
    expect((await response.json()).data.shortCode).toBe('launch')
    expect(links.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shortCode: 'launch' }),
      })
    )
  })

  it.each([
    ['an empty ending', '', 200],
    ['a null ending', null, 200],
    ['a slash', 'a/b', 400],
    ['a space inside', 'a b', 400],
    ['65 characters', 'a'.repeat(65), 400],
  ])('treats %s as asked', async (_name, code, status) => {
    links.create.mockResolvedValue(stored)
    const response = await create(
      json('https://flare.test/api/urls', { url: stored.targetUrl, code })
    )
    expect(response.status).toBe(status)
    if (status === 400) {
      expect((await response.json()).success).toBe(false)
      expect(links.create).not.toHaveBeenCalled()
    } else
      expect(links.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shortCode: expect.stringMatching(/^[A-Za-z0-9_-]{6}$/),
          }),
        })
      )
  })

  it('answers a taken ending with 409', async () => {
    links.findFirst.mockResolvedValue({ id: 'cm_other' })
    const response = await create(
      json('https://flare.test/api/urls', {
        url: stored.targetUrl,
        code: 'Launch',
      })
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      success: false,
      error: 'That ending is already taken. Choose another.',
    })
  })

  it('changes where an owned link leads and keeps its code', async () => {
    const moved = 'https://example.com/moved'
    links.findUnique.mockResolvedValue({ userId: 'owner' })
    links.update.mockResolvedValue({ ...stored, targetUrl: moved })
    const response = await updateOwn(
      json('https://flare.test/api/urls/cm_link', { url: moved }, 'PATCH'),
      params({ id: 'cm_link' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { ...sent, targetUrl: moved },
      success: true,
    })
  })

  it.each([
    ['a new ending', { url: 'https://example.com/x', code: 'other' }],
    ['no destination', {}],
    ['a non-web destination', { url: 'javascript:alert(1)' }],
  ])('refuses an edit with %s', async (_name, body) => {
    links.findUnique.mockResolvedValue({ userId: 'owner' })
    const response = await updateOwn(
      json('https://flare.test/api/urls/cm_link', body, 'PATCH'),
      params({ id: 'cm_link' })
    )
    expect(response.status).toBe(400)
    expect(links.update).not.toHaveBeenCalled()
  })

  it.each([['links.create'], ['links.delete']])(
    'refuses an edit to a role with only %s',
    async (permission) => {
      mocks.account.mockResolvedValue({
        id: 'owner',
        permissions: ['links.read', permission],
        credential: 'session',
      })
      const response = await updateOwn(
        json(
          'https://flare.test/api/urls/cm_link',
          { url: 'https://example.com/x' },
          'PATCH'
        ),
        params({ id: 'cm_link' })
      )
      expect(response.status).toBe(403)
      expect(links.update).not.toHaveBeenCalled()
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
    await auditSettled()
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
