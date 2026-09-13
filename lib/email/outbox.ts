import { type MailOutbox, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'

import { getEmailConfig } from './config'
import { decryptSecret, encryptSecret } from './crypto'
import type { EmailConfig } from './schema'
import { type RenderedEmail, renderAccountEmail } from './templates'
import {
  MailDeliveryError,
  describeMailError,
  isPermanentMailError,
  sendMail,
} from './transport'

export class MailLimitError extends MailDeliveryError {
  constructor() {
    super(
      'The daily email sending limit has been reached. Try again tomorrow or contact your administrator.'
    )
    this.name = 'MailLimitError'
  }
}

export interface EnqueueMailInput extends RenderedEmail {
  userId?: string
  tokenId?: string
  purpose: string
  recipient: string
  expiresAt?: Date
}

type EnqueueTransaction = Pick<
  Prisma.TransactionClient,
  'mailOutbox' | 'emailRateLimit' | '$executeRaw'
>

/** Call inside the account transaction so a token can never exist without its mail. */
export async function enqueueMail(
  tx: EnqueueTransaction,
  input: EnqueueMailInput,
  config?: EmailConfig
): Promise<MailOutbox> {
  const settings = config ?? (await getEmailConfig())
  if (!settings.enabled) throw new Error('Email delivery is disabled.')
  // Serialize admission across replicas. This includes messages later rejected by SMTP.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347201)`
  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  // Keep usage independent of accounts and delivery-history retention. Deleting
  // an account cascades its outbox rows and must never refund sending capacity.
  const key = `mail:daily:${midnight.toISOString().slice(0, 10)}`
  const counter = await tx.emailRateLimit.findUnique({ where: { key } })
  if ((counter?.count ?? 0) >= settings.limits.dailyLimit)
    throw new MailLimitError()
  await tx.emailRateLimit.upsert({
    where: { key },
    create: {
      key,
      count: 1,
      resetAt: new Date(midnight.getTime() + 86_400_000),
    },
    update: { count: { increment: 1 } },
  })
  return tx.mailOutbox.create({
    data: {
      userId: input.userId,
      tokenId: input.tokenId,
      purpose: input.purpose,
      recipient: input.recipient,
      payload: encryptSecret(
        JSON.stringify({
          subject: input.subject,
          text: input.text,
          html: input.html,
        }),
        'outbox'
      ),
      expiresAt: input.expiresAt,
      maxAttempts: settings.delivery.maxAttempts,
    },
  })
}

function leaseDuration(config: EmailConfig): number {
  return Math.max(120_000, config.smtp.timeoutSeconds * 5_000)
}

/** SKIP LOCKED and one UPDATE ensure independent workers cannot claim the same row. */
export async function claimMail(config: EmailConfig): Promise<MailOutbox[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347203)`
    const now = new Date()
    const active = await tx.mailOutbox.count({
      where: { status: 'processing', leaseUntil: { gt: now } },
    })
    const slots = Math.max(0, config.delivery.concurrency - active)
    if (!slots) return []
    const leaseUntil = new Date(now.getTime() + leaseDuration(config))
    const leaseId = randomUUID()
    return tx.$queryRaw<MailOutbox[]>`
    WITH candidates AS (
      SELECT id FROM "MailOutbox"
      WHERE ((status = 'pending' AND "availableAt" <= ${now})
        OR (status = 'processing' AND "leaseUntil" <= ${now}))
        AND attempts < "maxAttempts"
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      ORDER BY "availableAt", "createdAt"
      LIMIT ${slots}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "MailOutbox" AS mail
    SET status = 'processing', attempts = attempts + 1,
      "leaseId" = ${leaseId}, "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
    FROM candidates WHERE mail.id = candidates.id
    RETURNING mail.*
  `
  })
}

async function finishMail(
  mail: MailOutbox,
  data: Prisma.MailOutboxUpdateManyMutationInput
): Promise<void> {
  await prisma.mailOutbox.updateMany({
    where: { id: mail.id, status: 'processing', leaseId: mail.leaseId },
    data: { ...data, leaseId: null, leaseUntil: null },
  })
}

export async function deliverClaimedMail(
  mail: MailOutbox,
  config: EmailConfig
): Promise<boolean> {
  const now = new Date()
  const ownership = await prisma.mailOutbox.findUnique({
    where: { id: mail.id },
    select: { status: true, leaseId: true, leaseUntil: true },
  })
  if (
    !ownership ||
    ownership.status !== 'processing' ||
    ownership.leaseId !== mail.leaseId ||
    !ownership.leaseUntil ||
    ownership.leaseUntil <= now
  )
    return false
  if (!config.enabled || (mail.expiresAt && mail.expiresAt <= now)) {
    await finishMail(mail, {
      status: 'cancelled',
      payload: '',
      lastError: 'Email disabled or account link expired.',
    })
    return false
  }
  if (mail.tokenId) {
    const token = await prisma.emailToken.findUnique({
      where: { id: mail.tokenId },
    })
    if (
      !token ||
      token.consumedAt ||
      token.expiresAt <= now ||
      token.email !== mail.recipient ||
      token.userId !== mail.userId ||
      token.purpose !== mail.purpose
    ) {
      await finishMail(mail, {
        status: 'cancelled',
        payload: '',
        lastError: 'The account link is no longer valid.',
      })
      return false
    }
  } else if (
    ['verify', 'reset', 'change', 'change_approval'].includes(mail.purpose)
  ) {
    // A deleted token sets tokenId to null. Never send its orphaned account link.
    await finishMail(mail, {
      status: 'cancelled',
      payload: '',
      lastError: 'The account link is no longer valid.',
    })
    return false
  }

  // Renew claims during slow SMTP exchanges. Crash recovery uses the last lease.
  let renewing = false
  const heartbeat = setInterval(() => {
    if (renewing) return
    renewing = true
    prisma.mailOutbox
      .updateMany({
        where: {
          id: mail.id,
          status: 'processing',
          leaseId: mail.leaseId,
          leaseUntil: { gt: new Date() },
        },
        data: { leaseUntil: new Date(Date.now() + leaseDuration(config)) },
      })
      .catch(() => undefined)
      .finally(() => {
        renewing = false
      })
  }, 30_000)
  heartbeat.unref()
  try {
    // Delivery credentials and enablement may change after a worker claims a batch.
    // A test deliberately uses the administrator's unsaved candidate configuration.
    const current = mail.purpose === 'test' ? config : await getEmailConfig()
    if (
      !current.enabled ||
      (mail.purpose === 'reset' && !current.recovery.enabled) ||
      (['change', 'change_approval'].includes(mail.purpose) &&
        !current.changes.enabled)
    ) {
      await finishMail(mail, {
        status: 'cancelled',
        payload: '',
        lastError: 'This email feature was disabled.',
      })
      return false
    }
    const payload: unknown = JSON.parse(decryptSecret(mail.payload, 'outbox'))
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('subject' in payload) ||
      !('text' in payload) ||
      !('html' in payload) ||
      typeof payload.subject !== 'string' ||
      typeof payload.text !== 'string' ||
      typeof payload.html !== 'string'
    ) {
      throw new Error('Invalid encrypted email payload.')
    }
    await sendMail(current, {
      recipient: mail.recipient,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      // A retry uses the same link and message ID. SMTP remains at-least-once.
      messageId: `<flare-${mail.id}@${new URL(config.publicUrl).hostname}>`,
    })
    await finishMail(mail, {
      status: 'sent',
      sentAt: new Date(),
      payload: '',
      lastError: null,
    })
    return true
  } catch (error) {
    const shouldRetry =
      mail.attempts < mail.maxAttempts && !isPermanentMailError(error)
    const retryAt = new Date(
      Date.now() +
        config.delivery.retrySeconds *
          1000 *
          2 ** Math.min(Math.max(mail.attempts - 1, 0), 10)
    )
    const unexpired = !mail.expiresAt || retryAt < mail.expiresAt
    await finishMail(mail, {
      status: shouldRetry && unexpired ? 'pending' : 'failed',
      availableAt: retryAt,
      lastError: describeMailError(error),
    })
    return false
  } finally {
    clearInterval(heartbeat)
  }
}

/** Purge secret-bearing payloads promptly and bounded diagnostic history later. */
export async function cleanupMail(config: EmailConfig): Promise<void> {
  const now = new Date()
  await prisma.mailOutbox.updateMany({
    where: {
      status: { in: ['pending', 'processing', 'failed'] },
      expiresAt: { lte: now },
    },
    data: {
      status: 'cancelled',
      payload: '',
      leaseId: null,
      leaseUntil: null,
      lastError: 'The account link expired.',
    },
  })
  await prisma.$executeRaw`
    UPDATE "MailOutbox" SET status = 'failed', "leaseId" = NULL, "leaseUntil" = NULL,
      "lastError" = 'Delivery attempts exhausted after worker interruption.', "updatedAt" = ${now}
    WHERE attempts >= "maxAttempts" AND (status = 'pending'
      OR (status = 'processing' AND "leaseUntil" <= ${now}))
  `
  const cutoff = new Date(
    now.getTime() - config.delivery.retentionDays * 86_400_000
  )
  await prisma.mailOutbox.deleteMany({
    where: {
      status: { in: ['sent', 'failed', 'cancelled'] },
      createdAt: { lt: cutoff },
    },
  })
  await prisma.emailToken.deleteMany({ where: { expiresAt: { lt: cutoff } } })
  await prisma.emailRateLimit.deleteMany({ where: { resetAt: { lt: now } } })
}

/** A manual retry never revives an expired/revoked account link. */
export async function retryMail(id: string): Promise<boolean> {
  const config = await getEmailConfig()
  if (!config.enabled) throw new Error('Email delivery is disabled.')
  const mail = await prisma.mailOutbox.findUnique({ where: { id } })
  if (
    !mail ||
    mail.status !== 'failed' ||
    !mail.payload ||
    (mail.expiresAt && mail.expiresAt <= new Date())
  )
    return false
  if (mail.tokenId) {
    const token = await prisma.emailToken.findUnique({
      where: { id: mail.tokenId },
    })
    if (!token || token.consumedAt || token.expiresAt <= new Date())
      return false
  }
  const result = await prisma.mailOutbox.updateMany({
    where: { id, status: 'failed' },
    data: {
      status: 'pending',
      attempts: 0,
      maxAttempts: config.delivery.maxAttempts,
      availableAt: new Date(),
      lastError: null,
      leaseUntil: null,
      leaseId: null,
    },
  })
  return result.count === 1
}

/** Tests are admitted and recorded like all other messages, then sent immediately. */
export async function deliverTestEmail(
  config: EmailConfig,
  recipient: string
): Promise<void> {
  const mail = await prisma.$transaction(async (tx) => {
    // Same admission lock as background claims: test messages share their slots.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347203)`
    const active = await tx.mailOutbox.count({
      where: { status: 'processing', leaseUntil: { gt: new Date() } },
    })
    if (active >= config.delivery.concurrency)
      throw new MailDeliveryError(
        'All email delivery slots are busy. Try the test again shortly.'
      )
    const reserved = await enqueueMail(
      tx,
      {
        purpose: 'test',
        recipient,
        ...renderAccountEmail(config, { kind: 'test', recipient }),
      },
      config
    )
    return tx.mailOutbox.update({
      where: { id: reserved.id },
      data: {
        status: 'processing',
        attempts: 1,
        // A draft test must not later retry through different, saved SMTP settings.
        maxAttempts: 1,
        leaseId: randomUUID(),
        leaseUntil: new Date(Date.now() + leaseDuration(config)),
      },
    })
  })
  if (!(await deliverClaimedMail(mail, config))) {
    const result = await prisma.mailOutbox.findUnique({
      where: { id: mail.id },
      select: { lastError: true },
    })
    throw new MailDeliveryError(
      result?.lastError || 'The test email could not be sent.'
    )
  }
}
