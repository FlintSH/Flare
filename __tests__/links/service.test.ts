import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditContext, auditContext } from '@/lib/audit/context'
import {
  createShortLink,
  deleteAccountShortLink,
  deleteOwnShortLink,
  followShortLink,
  listAccountShortLinks,
  listOwnShortLinks,
} from '@/lib/links/service'

const mocks = vi.hoisted(() => ({
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
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks }))

const links = mocks.shortenedUrl
const createdAt = new Date('2026-09-20T12:00:00.000Z')
const stored = {
  id: 'cm_link',
  shortCode: 'aB3_dE',
  targetUrl: 'https://example.com/a/long/path',
  clicks: 0,
  createdAt,
  userId: 'owner',
}
const sent = { ...stored, createdAt: '2026-09-20T12:00:00.000Z' }
const code = /^[A-Za-z0-9_-]{6}$/

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Database refused the write', {
    code,
    clientVersion: 'test',
  })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('creating a short link', () => {
  it('stores a six-character code for the owner and sends its date as text', async () => {
    links.create.mockResolvedValue(stored)
    const link = await createShortLink('owner', stored.targetUrl)
    expect(link).toEqual(sent)
    expect(links.create).toHaveBeenCalledWith({
      data: {
        shortCode: expect.stringMatching(code),
        targetUrl: stored.targetUrl,
        userId: 'owner',
      },
      select: {
        id: true,
        shortCode: true,
        targetUrl: true,
        clicks: true,
        createdAt: true,
        userId: true,
      },
    })
  })

  it('draws another code when the first is taken, as by a concurrent request', async () => {
    links.create
      .mockRejectedValueOnce(prismaError('P2002'))
      .mockResolvedValueOnce(stored)
    expect(await createShortLink('owner', stored.targetUrl)).toEqual(sent)
    const [first, second] = links.create.mock.calls.map(
      ([args]) => args.data.shortCode
    )
    expect(first).toMatch(code)
    expect(second).toMatch(code)
    expect(second).not.toBe(first)
  })

  it('gives up after five taken codes', async () => {
    const taken = prismaError('P2002')
    links.create.mockRejectedValue(taken)
    await expect(createShortLink('owner', stored.targetUrl)).rejects.toBe(taken)
    expect(links.create).toHaveBeenCalledTimes(5)
  })

  it('does not retry other failures', async () => {
    const ownerGone = prismaError('P2003')
    links.create.mockRejectedValue(ownerGone)
    await expect(createShortLink('owner', stored.targetUrl)).rejects.toBe(
      ownerGone
    )
    links.create.mockRejectedValue(new Error('connection lost'))
    await expect(createShortLink('owner', stored.targetUrl)).rejects.toThrow(
      'connection lost'
    )
    expect(links.create).toHaveBeenCalledTimes(2)
  })
})

describe("the owner's links", () => {
  it('lists only the owner, newest first, with dates as text', async () => {
    links.findMany.mockResolvedValue([stored])
    expect(await listOwnShortLinks('owner')).toEqual([sent])
    expect(links.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner' },
        orderBy: { createdAt: 'desc' },
      })
    )
  })

  it('reports a missing link without deleting anything', async () => {
    links.findUnique.mockResolvedValue(null)
    await expect(deleteOwnShortLink('owner', 'cm_link')).rejects.toMatchObject({
      status: 404,
      message: 'URL not found',
    })
    expect(links.delete).not.toHaveBeenCalled()
  })

  it("refuses another account's link without deleting it", async () => {
    links.findUnique.mockResolvedValue({ userId: 'someone-else' })
    await expect(deleteOwnShortLink('owner', 'cm_link')).rejects.toMatchObject({
      status: 403,
      message: 'Unauthorized',
    })
    expect(links.delete).not.toHaveBeenCalled()
  })

  it('deletes an owned link by its id', async () => {
    links.findUnique.mockResolvedValue({ userId: 'owner' })
    await deleteOwnShortLink('owner', 'cm_link')
    expect(links.findUnique).toHaveBeenCalledWith({
      where: { id: 'cm_link' },
      select: { userId: true },
    })
    expect(links.delete).toHaveBeenCalledWith({ where: { id: 'cm_link' } })
  })
})

describe('moderating an account', () => {
  const query = { page: 1, limit: 10, search: '' }

  it.each([Number.NaN, 0, -2, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    'uses page 1 and 10 links for a page or limit of %s',
    async (value) => {
      links.count.mockResolvedValue(30)
      links.findMany.mockResolvedValue([])
      expect(
        (
          await listAccountShortLinks('member', {
            ...query,
            page: value,
            limit: value,
          })
        ).pagination
      ).toEqual({ total: 30, pages: 3, page: 1, limit: 10 })
      expect(links.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      )
    }
  )

  it('caps the limit at 100 and the page at the last one', async () => {
    links.count.mockResolvedValue(250)
    links.findMany.mockResolvedValue([])
    expect(
      (await listAccountShortLinks('member', { ...query, page: 9, limit: 500 }))
        .pagination
    ).toEqual({ total: 250, pages: 3, page: 3, limit: 100 })
    expect(links.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 200, take: 100 })
    )
  })

  it('answers an account without links with page 1 of 0', async () => {
    links.count.mockResolvedValue(0)
    links.findMany.mockResolvedValue([])
    expect(
      await listAccountShortLinks('member', { ...query, page: 4 })
    ).toEqual({
      urls: [],
      pagination: { total: 0, pages: 0, page: 1, limit: 10 },
    })
    expect(links.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    )
  })

  it('searches codes and destinations, newest first, without the owner', async () => {
    const { userId: _owner, ...listed } = stored
    links.count.mockResolvedValue(1)
    links.findMany.mockResolvedValue([listed])
    const where = {
      userId: 'member',
      OR: [
        { shortCode: { contains: 'Path', mode: 'insensitive' } },
        { targetUrl: { contains: 'Path', mode: 'insensitive' } },
      ],
    }
    expect(
      await listAccountShortLinks('member', { ...query, search: 'Path' })
    ).toEqual({
      urls: [{ ...listed, createdAt: sent.createdAt }],
      pagination: { total: 1, pages: 1, page: 1, limit: 10 },
    })
    expect(links.count).toHaveBeenCalledWith({ where })
    expect(links.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
      select: {
        id: true,
        shortCode: true,
        targetUrl: true,
        clicks: true,
        createdAt: true,
        userId: false,
      },
    })
    await listAccountShortLinks('member', query)
    expect(links.count).toHaveBeenLastCalledWith({
      where: { userId: 'member' },
    })
  })

  it("deletes only the account's own link", async () => {
    links.deleteMany.mockResolvedValue({ count: 1 })
    await deleteAccountShortLink('member', 'cm_link')
    expect(links.deleteMany).toHaveBeenCalledWith({
      where: { id: 'cm_link', userId: 'member' },
    })
    links.deleteMany.mockResolvedValue({ count: 0 })
    await expect(
      deleteAccountShortLink('member', 'cm_other')
    ).rejects.toMatchObject({ status: 404, message: 'URL not found' })
  })
})

describe('following a short link', () => {
  it('returns null for an unknown code without counting', async () => {
    links.findUnique.mockResolvedValue(null)
    expect(await followShortLink('nope00')).toBeNull()
    expect(links.update).not.toHaveBeenCalled()
  })

  it('counts the click and names the link in the request audit', async () => {
    links.findUnique.mockResolvedValue(stored)
    const request: AuditContext = {}
    const target = await auditContext.run(request, () =>
      followShortLink('aB3_dE')
    )
    expect(target).toBe(stored.targetUrl)
    expect(links.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shortCode: 'aB3_dE' } })
    )
    expect(links.update).toHaveBeenCalledWith({
      where: { id: 'cm_link' },
      data: { clicks: { increment: 1 } },
    })
    expect(request).toMatchObject({
      targetType: 'link',
      targetId: 'cm_link',
      targetName: 'aB3_dE',
    })
  })
})
