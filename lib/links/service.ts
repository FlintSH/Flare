import { Prisma } from '@prisma/client'
import { nanoid } from 'nanoid'

import { setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import type { AccountShortLinkPage, ShortLink } from '@/lib/links/schema'

class ShortLinkError extends HttpError {
  constructor(message: string, status: number) {
    super(status, message)
    this.name = 'ShortLinkError'
  }
}

const shortLinkSelect = {
  id: true,
  shortCode: true,
  targetUrl: true,
  clicks: true,
  createdAt: true,
  userId: true,
} satisfies Prisma.ShortenedUrlSelect

/** Codes are random, so another draw almost always finds a free one. */
const CODE_ATTEMPTS = 5
const DEFAULT_PAGE_LIMIT = 10
const MAX_PAGE_LIMIT = 100

function linkView<Link extends { createdAt: Date }>(
  link: Link
): Omit<Link, 'createdAt'> & { createdAt: string } {
  return { ...link, createdAt: link.createdAt.toISOString() }
}

const positiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0

/** A new link under a free six-character code. */
export async function createShortLink(
  userId: string,
  targetUrl: string
): Promise<ShortLink> {
  for (let attempt = 1; ; attempt++) {
    try {
      return linkView(
        await prisma.shortenedUrl.create({
          data: { shortCode: nanoid(6), targetUrl, userId },
          select: shortLinkSelect,
        })
      )
    } catch (error) {
      // A fresh id can't collide, so a unique conflict means the code is taken.
      const codeTaken =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      if (!codeTaken || attempt === CODE_ATTEMPTS) throw error
    }
  }
}

/** The owner's links, newest first. */
export async function listOwnShortLinks(userId: string): Promise<ShortLink[]> {
  const links = await prisma.shortenedUrl.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: shortLinkSelect,
  })
  return links.map((link) => linkView(link))
}

/** Another account's link is refused rather than reported missing. */
export async function deleteOwnShortLink(userId: string, id: string) {
  const link = await prisma.shortenedUrl.findUnique({
    where: { id },
    select: { userId: true },
  })
  if (!link) throw new ShortLinkError('URL not found', 404)
  if (link.userId !== userId) throw new ShortLinkError('Unauthorized', 403)
  await prisma.shortenedUrl.delete({ where: { id } })
}

/**
 * One page of an account's links for moderators, newest first. A page or
 * limit that isn't a positive integer gets its default; the limit is capped
 * at 100 and the page at the last one.
 */
export async function listAccountShortLinks(
  userId: string,
  query: { page: number; limit: number; search: string }
): Promise<AccountShortLinkPage> {
  const limit = positiveInteger(query.limit)
    ? Math.min(query.limit, MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT
  const where: Prisma.ShortenedUrlWhereInput = {
    userId,
    ...(query.search
      ? {
          OR: [
            { shortCode: { contains: query.search, mode: 'insensitive' } },
            { targetUrl: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const total = await prisma.shortenedUrl.count({ where })
  const pages = Math.ceil(total / limit)
  const page = Math.min(
    positiveInteger(query.page) ? query.page : 1,
    Math.max(1, pages)
  )
  const links = await prisma.shortenedUrl.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    select: { ...shortLinkSelect, userId: false },
  })
  return {
    urls: links.map((link) => linkView(link)),
    pagination: { total, pages, page, limit },
  }
}

/** Moderators delete by account and id together; any other link is missing. */
export async function deleteAccountShortLink(userId: string, id: string) {
  const { count } = await prisma.shortenedUrl.deleteMany({
    where: { id, userId },
  })
  if (!count) throw new ShortLinkError('URL not found', 404)
}

/** The destination for a code, counting the click; null for an unknown code. */
export async function followShortLink(
  shortCode: string
): Promise<string | null> {
  const link = await prisma.shortenedUrl.findUnique({
    where: { shortCode },
    select: { id: true, shortCode: true, targetUrl: true },
  })
  if (!link) return null
  // The click counter is not a separate change event; the request's audit
  // event names the link instead.
  setAuditTarget({ type: 'link', id: link.id, name: link.shortCode })
  await prisma.shortenedUrl.update({
    where: { id: link.id },
    data: { clicks: { increment: 1 } },
  })
  return link.targetUrl
}
