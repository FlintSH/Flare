import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { MailLimitError, enqueueMail } from '@/lib/email/outbox'
import { hasVerifiedEmail } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
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

type NotifyState = {
  id: string
  userId: string
  title: string
  notify: boolean
  notifiedAt: Date | null
  fileCount: number
  bytesReceived: bigint
  notifiedFiles: number
  notifiedBytes: bigint
}

/**
 * One notification decision per request at a time: an email, or the owner
 * turning email on or off, so an email being written can't undo the counts
 * that turning it on resets. Take it before any other lock. An advisory lock,
 * not the request row: the email's outbox row references the owner's account,
 * and deliveries lock the account row before the request row. The request row
 * is only updated last, after the email is queued.
 */
export async function lockRequestNotifications(
  tx: Prisma.TransactionClient,
  requestId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347220, hashtext(${requestId}))`
}

async function withNotifyLock<T>(
  requestId: string,
  action: (tx: Prisma.TransactionClient, request: NotifyState) => Promise<T>
): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    await lockRequestNotifications(tx, requestId)
    const request = await tx.fileRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        userId: true,
        title: true,
        notify: true,
        notifiedAt: true,
        fileCount: true,
        bytesReceived: true,
        notifiedFiles: true,
        notifiedBytes: true,
      },
    })
    return request ? action(tx, request) : null
  })
}

const hasNews = (request: NotifyState) =>
  request.notify && request.fileCount > request.notifiedFiles

const dueAt = (request: NotifyState, now: Date) =>
  request.notifiedAt
    ? new Date(request.notifiedAt.getTime() + NOTIFICATION_INTERVAL_MS)
    : now

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

/**
 * Queues the email for every delivery since the last one, then marks them
 * reported, in the same transaction: a failure leaves them unreported, so the
 * next delivery or scheduled digest tries again. When mail is off, the owner
 * has no verified address, or a cap applies, they are marked reported without
 * an email.
 *
 * Deliveries are counted with the request's own counters, which a delivery
 * updates as it commits, rather than by when files arrived: one that is still
 * committing isn't in the counts read here, so it is left for the next email
 * instead of falling behind the new mark.
 */
async function sendDigest(
  tx: Prisma.TransactionClient,
  request: NotifyState,
  config: EmailConfig,
  now: Date
) {
  await queueDigestEmail(tx, request, config, now)
  await tx.fileRequest.update({
    where: { id: request.id },
    data: {
      notifiedAt: now,
      notifiedFiles: request.fileCount,
      notifiedBytes: request.bytesReceived,
    },
    select: { id: true },
  })
  await tx.event.deleteMany({ where: waiting(request.id) })
}

async function queueDigestEmail(
  tx: Prisma.TransactionClient,
  request: NotifyState,
  config: EmailConfig,
  now: Date
) {
  if (!config.enabled) return
  const owner = await tx.user.findUnique({
    where: { id: request.userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      emailVerifiedFor: true,
      emailVerificationSource: true,
    },
  })
  if (!owner?.email || !hasVerifiedEmail(owner, config)) return
  const fileCount = request.fileCount - request.notifiedFiles
  const bytes = Number(request.bytesReceived - request.notifiedBytes)
  const url = new URL('/dashboard/requests', config.publicUrl)
  url.searchParams.set('id', request.id)
  // Names and notes senders typed stay in the dashboard, out of email.
  const message = renderFileRequestEmail(config, {
    username: owner.name || undefined,
    title: request.title,
    fileCount,
    totalSize: formatRequestBytes(bytes),
    url: url.toString(),
  })
  const day = new Date(now)
  day.setUTCHours(0, 0, 0, 0)
  const date = day.toISOString().slice(0, 10)
  const ownerKey = `file-request:daily:${date}:${request.userId}`
  // The same admission lock enqueueMail takes, so the counts hold.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347201)`
  const shared = await tx.emailRateLimit.findUnique({
    where: { key: `mail:daily:${date}` },
  })
  const own = await tx.emailRateLimit.findUnique({ where: { key: ownerKey } })
  if (
    (shared?.count ?? 0) >=
      Math.floor(config.limits.dailyLimit * (1 - ACCOUNT_MAIL_SHARE)) ||
    (own?.count ?? 0) >= MAX_REQUEST_EMAILS_PER_DAY
  ) {
    logger.warn('Skipped a file request email: a daily email cap applies', {
      requestId: request.id,
    })
    return
  }
  try {
    await enqueueMail(
      tx,
      {
        userId: request.userId,
        purpose: 'file_request',
        recipient: owner.email,
        ...message,
      },
      config
    )
  } catch (error) {
    if (!(error instanceof MailLimitError)) throw error
    logger.warn('Skipped a file request email: the daily limit was reached', {
      requestId: request.id,
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
    // Read before the transaction: email settings may need their own.
    const config = await getEmailConfig()
    await withNotifyLock(requestId, async (tx, request) => {
      if (!hasNews(request)) return
      const now = new Date()
      const due = dueAt(request, now)
      if (batchFinished && due <= now)
        return sendDigest(tx, request, config, now)
      await scheduleDigest(
        tx,
        request.id,
        batchFinished
          ? due
          : new Date(
              Math.max(due.getTime(), now.getTime() + NOTIFICATION_INTERVAL_MS)
            )
      )
    })
  } catch (error) {
    // The arrivals stay unreported; a later delivery or digest tries again.
    logger.error('Could not record a file request notification', error as Error)
  }
}

/** Runs for a scheduled digest. Throwing lets the event worker retry it. */
export async function sendScheduledDigest(requestId: string) {
  const config = await getEmailConfig()
  await withNotifyLock(requestId, async (tx, request) => {
    if (!hasNews(request)) return
    const now = new Date()
    const due = dueAt(request, now)
    if (due > now) await scheduleDigest(tx, request.id, due)
    else await sendDigest(tx, request, config, now)
  })
}

export async function registerFileRequestHandlers() {
  await events.on(
    EVENT_TYPE,
    'send-digest',
    async (payload: { requestId: string }) =>
      sendScheduledDigest(payload.requestId)
  )
}
