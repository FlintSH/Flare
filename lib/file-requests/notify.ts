import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { MailLimitError, enqueueMail } from '@/lib/email/outbox'
import { hasVerifiedEmail } from '@/lib/email/policy'
import { renderFileRequestEmail } from '@/lib/email/templates'
import { events } from '@/lib/events'
import { loggers } from '@/lib/logger'

import {
  MAX_REQUEST_EMAILS_PER_DAY,
  NOTIFICATION_INTERVAL_MS,
  formatRequestBytes,
} from './policy'

const logger = loggers.files.getChildLogger('file-requests')
const EVENT_TYPE = 'file-request.notify'
/** Account email always keeps this share of the instance's daily limit. */
const ACCOUNT_MAIL_SHARE = 0.2
const waiting = (requestId: string) => ({
  type: EVENT_TYPE,
  status: { in: ['SCHEDULED' as const, 'PENDING' as const] },
  payload: { path: ['requestId'], equals: requestId },
})

/**
 * Locks only the request row. Mail is sent in a separate transaction, because
 * it touches the owner's account row, which deliveries lock before this one.
 */
async function lockRequest(tx: Prisma.TransactionClient, requestId: string) {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "FileRequest" WHERE "id" = ${requestId} FOR UPDATE`
  if (!locked.length) return null
  return tx.fileRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      title: true,
      notify: true,
      notifiedAt: true,
      lastReceivedAt: true,
    },
  })
}
type LockedRequest = NonNullable<Awaited<ReturnType<typeof lockRequest>>>
type Digest = {
  requestId: string
  userId: string
  title: string
  since: Date
  until: Date
}

const hasNews = (request: LockedRequest) =>
  request.notify &&
  request.lastReceivedAt !== null &&
  (!request.notifiedAt || request.lastReceivedAt > request.notifiedAt)

/** One waiting digest per request; an earlier deadline wins. */
async function scheduleDigest(
  tx: Prisma.TransactionClient,
  requestId: string,
  at: Date
) {
  const existing = await tx.event.findFirst({
    where: waiting(requestId),
    select: { id: true, scheduledAt: true },
  })
  if (existing) {
    if (existing.scheduledAt && existing.scheduledAt > at)
      await tx.event.update({
        where: { id: existing.id },
        data: { scheduledAt: at },
      })
    return
  }
  await tx.event.create({
    data: {
      type: EVENT_TYPE,
      status: 'SCHEDULED',
      scheduledAt: at,
      payload: { requestId },
    },
  })
}

/** Marks everything until now as reported, so the same arrivals never loop. */
async function claimDigest(
  tx: Prisma.TransactionClient,
  request: LockedRequest,
  now: Date
): Promise<Digest> {
  await tx.fileRequest.update({
    where: { id: request.id },
    data: { notifiedAt: now },
    select: { id: true },
  })
  await tx.event.deleteMany({ where: waiting(request.id) })
  return {
    requestId: request.id,
    userId: request.userId,
    title: request.title,
    since: request.notifiedAt ?? new Date(0),
    until: now,
  }
}

/**
 * Emails a claimed digest. Best effort: when mail is off, the owner has no
 * verified address, or a cap applies, the arrivals stay unreported by email.
 */
async function sendDigest(digest: Digest) {
  const config = await getEmailConfig()
  if (!config.enabled) return
  const owner = await prisma.user.findUnique({
    where: { id: digest.userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      emailVerifiedFor: true,
      emailVerificationSource: true,
    },
  })
  if (!owner?.email || !hasVerifiedEmail(owner, config)) return
  const recipient = owner.email
  // Files the owner already deleted are not news.
  const totals = await prisma.file.aggregate({
    where: {
      userId: digest.userId,
      uploadedAt: { gt: digest.since, lte: digest.until },
      fileRequestSubmission: { requestId: digest.requestId },
    },
    _count: { _all: true },
    _sum: { size: true },
  })
  if (!totals._count._all) return
  const url = new URL('/dashboard/requests', config.publicUrl)
  url.searchParams.set('id', digest.requestId)
  // Names and notes senders typed stay in the dashboard, out of email.
  const message = renderFileRequestEmail(config, {
    username: owner.name || undefined,
    title: digest.title,
    fileCount: totals._count._all,
    totalSize: formatRequestBytes(
      Math.round((totals._sum.size ?? 0) * 1024 * 1024)
    ),
    url: url.toString(),
  })
  const day = new Date()
  day.setUTCHours(0, 0, 0, 0)
  const date = day.toISOString().slice(0, 10)
  const ownerKey = `file-request:daily:${date}:${digest.userId}`
  try {
    await prisma.$transaction(async (tx) => {
      // The same admission lock enqueueMail takes, so the counts hold.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347201)`
      const shared = await tx.emailRateLimit.findUnique({
        where: { key: `mail:daily:${date}` },
      })
      const own = await tx.emailRateLimit.findUnique({
        where: { key: ownerKey },
      })
      if (
        (shared?.count ?? 0) >=
          Math.floor(config.limits.dailyLimit * (1 - ACCOUNT_MAIL_SHARE)) ||
        (own?.count ?? 0) >= MAX_REQUEST_EMAILS_PER_DAY
      ) {
        logger.warn('Skipped a file request email: a daily email cap applies', {
          requestId: digest.requestId,
        })
        return
      }
      await tx.emailRateLimit.upsert({
        where: { key: ownerKey },
        create: {
          key: ownerKey,
          count: 1,
          resetAt: new Date(day.getTime() + 86_400_000),
        },
        update: { count: { increment: 1 } },
      })
      await enqueueMail(
        tx,
        {
          userId: digest.userId,
          purpose: 'file_request',
          recipient,
          ...message,
        },
        config
      )
    })
  } catch (error) {
    if (!(error instanceof MailLimitError)) throw error
    logger.warn('Skipped a file request email: the daily limit was reached', {
      requestId: digest.requestId,
    })
  }
}

/**
 * Called after files arrive. A finished batch notifies at once, unless an
 * email went out recently; then, and for senders who leave without
 * finishing, a scheduled digest follows. Never fails the sender's upload.
 */
export async function recordDelivery(
  requestId: string,
  { batchFinished = false } = {}
) {
  try {
    const digest = await prisma.$transaction(async (tx) => {
      const request = await lockRequest(tx, requestId)
      if (!request || !hasNews(request)) return null
      const now = new Date()
      const dueAt = request.notifiedAt
        ? new Date(request.notifiedAt.getTime() + NOTIFICATION_INTERVAL_MS)
        : now
      if (batchFinished && dueAt <= now) return claimDigest(tx, request, now)
      await scheduleDigest(
        tx,
        request.id,
        batchFinished
          ? dueAt
          : new Date(
              Math.max(
                dueAt.getTime(),
                now.getTime() + NOTIFICATION_INTERVAL_MS
              )
            )
      )
      return null
    })
    if (digest) await sendDigest(digest)
  } catch (error) {
    logger.error('Could not record a file request notification', error as Error)
  }
}

export async function sendScheduledDigest(requestId: string) {
  const digest = await prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, requestId)
    if (!request || !hasNews(request)) return null
    const now = new Date()
    const dueAt = request.notifiedAt
      ? new Date(request.notifiedAt.getTime() + NOTIFICATION_INTERVAL_MS)
      : now
    if (dueAt > now) {
      await scheduleDigest(tx, request.id, dueAt)
      return null
    }
    return claimDigest(tx, request, now)
  })
  if (digest) await sendDigest(digest)
}

export async function registerFileRequestHandlers() {
  await events.on(
    EVENT_TYPE,
    'send-digest',
    async (payload: { requestId: string }) =>
      sendScheduledDigest(payload.requestId)
  )
}
