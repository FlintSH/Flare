import { type File, Prisma, type WebhookDelivery } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

import { prisma } from '@/lib/database/prisma'
import { decryptSecret } from '@/lib/email/crypto'

import { resolveWebhookTarget, signWebhook } from './security'

export const WEBHOOK_SECRET_PURPOSE = 'integrations.webhook.v1'
export const WEBHOOK_MAX_ATTEMPTS = 5
export const WEBHOOK_MAX_PENDING = 1000
export const WEBHOOK_MAX_PENDING_PER_USER = 5000
const CONCURRENCY = 4
type ReadyFile = Pick<
  File,
  | 'id'
  | 'userId'
  | 'name'
  | 'mimeType'
  | 'size'
  | 'uploadedAt'
  | 'visibility'
  | 'password'
>
type WebhookTransaction = Pick<
  Prisma.TransactionClient,
  'webhook' | 'webhookDelivery' | '$executeRaw'
>

export function fileReadyPayload(file: ReadyFile) {
  return {
    version: 1,
    id: `file.ready:${file.id}`,
    type: 'file.ready',
    occurredAt: file.uploadedAt.toISOString(),
    data: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: Math.round(file.size * 1024 * 1024),
      visibility: file.visibility,
      passwordProtected: Boolean(file.password),
    },
  }
}

/** Must be called in the same transaction that makes the file available. */
export async function enqueueFileReady(
  tx: WebhookTransaction,
  file: ReadyFile
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347213, hashtext(${file.userId}))`
  const hooks = await tx.webhook.findMany({
    where: { userId: file.userId, enabled: true },
    select: { id: true },
  })
  if (!hooks.length) return
  const pending = { status: { in: ['pending', 'processing'] } }
  let available =
    WEBHOOK_MAX_PENDING_PER_USER -
    (await tx.webhookDelivery.count({
      where: { ...pending, webhook: { userId: file.userId } },
    }))
  const destinations: string[] = []
  for (const hook of hooks) {
    if (available <= 0) break
    const count = await tx.webhookDelivery.count({
      where: { ...pending, webhookId: hook.id },
    })
    if (count < WEBHOOK_MAX_PENDING) {
      destinations.push(hook.id)
      available--
    }
  }
  // A stalled receiver must never prevent uploading. Overflow events are skipped.
  if (!destinations.length) return
  const payload = fileReadyPayload(file)
  await tx.webhookDelivery.createMany({
    data: destinations.map((id) => ({
      webhookId: id,
      eventId: payload.id,
      payload,
    })),
    skipDuplicates: true,
  })
}

export function retryDelayMs(attempts: number): number {
  return [60_000, 300_000, 1_800_000, 7_200_000][
    Math.min(Math.max(attempts - 1, 0), 3)
  ]
}

/** Global concurrency and row claims are serialized across app replicas. */
export async function claimWebhookDeliveries(): Promise<WebhookDelivery[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347211)`
    const now = new Date()
    await tx.webhookDelivery.updateMany({
      where: {
        status: 'processing',
        leaseUntil: { lte: now },
        attempts: { gte: WEBHOOK_MAX_ATTEMPTS },
      },
      data: {
        status: 'failed',
        leaseId: null,
        leaseUntil: null,
        lastError: 'Delivery lease expired after the final attempt.',
      },
    })
    const active = await tx.webhookDelivery.count({
      where: { status: 'processing', leaseUntil: { gt: now } },
    })
    const slots = Math.max(0, CONCURRENCY - active)
    if (!slots) return []
    const leaseId = randomUUID()
    const leaseUntil = new Date(now.getTime() + 60_000)
    return tx.$queryRaw<WebhookDelivery[]>`
      WITH candidates AS (
        SELECT d.id FROM "WebhookDelivery" d JOIN "Webhook" w ON w.id = d."webhookId"
        WHERE w.enabled = true AND d.attempts < ${WEBHOOK_MAX_ATTEMPTS}
          AND ((d.status = 'pending' AND d."availableAt" <= ${now})
            OR (d.status = 'processing' AND d."leaseUntil" <= ${now}))
        ORDER BY d."availableAt", d."createdAt"
        LIMIT ${slots} FOR UPDATE OF d SKIP LOCKED
      )
      UPDATE "WebhookDelivery" d SET status = 'processing', attempts = attempts + 1,
        "leaseId" = ${leaseId}, "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
      FROM candidates WHERE d.id = candidates.id RETURNING d.*
    `
  })
}

/** No redirects, DNS rebinding, unbounded body buffering or idle-only timeout. */
export async function sendWebhook(
  urlString: string,
  secret: string,
  eventId: string,
  payload: Prisma.JsonValue
): Promise<number> {
  const { url, address } = await resolveWebhookTarget(urlString)
  const body = JSON.stringify(payload)
  if (Buffer.byteLength(body) > 64 * 1024)
    throw new Error('Webhook payload exceeds 64 KiB.')
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return new Promise((resolve, reject) => {
    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = requester(
      url,
      {
        method: 'POST',
        agent: false,
        maxHeaderSize: 8192,
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'user-agent': 'Flare-Webhooks/1',
          'x-flare-event-id': eventId,
          'x-flare-timestamp': timestamp,
          'x-flare-signature': signWebhook(secret, timestamp, body),
        },
      },
      (response) => {
        let received = 0
        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received > 32 * 1024) {
            const error = new Error('Webhook response exceeds 32 KiB.')
            clearTimeout(timer)
            reject(error)
            request.destroy(error)
          }
        })
        response.on('error', reject)
        response.on('end', () => {
          clearTimeout(timer)
          resolve(response.statusCode ?? 500)
        })
      }
    )
    const timer = setTimeout(() => {
      const error = new Error('Webhook delivery timed out.')
      reject(error)
      request.destroy(error)
    }, 10_000)
    request.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.end(body)
  })
}

export async function deliverWebhook(delivery: WebhookDelivery): Promise<void> {
  const current = await prisma.webhookDelivery.findUnique({
    where: { id: delivery.id },
    include: { webhook: true },
  })
  if (
    !current ||
    current.status !== 'processing' ||
    current.leaseId !== delivery.leaseId ||
    !current.leaseUntil ||
    current.leaseUntil <= new Date()
  )
    return
  const ownership = {
    id: delivery.id,
    status: 'processing',
    leaseId: delivery.leaseId,
  }
  if (!current.webhook.enabled) {
    await prisma.webhookDelivery.updateMany({
      where: ownership,
      data: { status: 'cancelled', leaseId: null, leaseUntil: null },
    })
    return
  }
  const payload =
    delivery.payload &&
    typeof delivery.payload === 'object' &&
    !Array.isArray(delivery.payload)
      ? delivery.payload
      : null
  const test = payload?.test === true && delivery.eventId.startsWith('test:')
  if (!test) {
    const data =
      payload?.data &&
      typeof payload.data === 'object' &&
      !Array.isArray(payload.data)
        ? payload.data
        : null
    const file =
      typeof data?.id === 'string'
        ? await prisma.file.findUnique({
            where: { id: data.id },
            select: { userId: true, visibility: true, password: true },
          })
        : null
    if (
      !file ||
      file.userId !== current.webhook.userId ||
      file.visibility !== data?.visibility ||
      Boolean(file.password) !== data?.passwordProtected
    ) {
      await prisma.webhookDelivery.updateMany({
        where: ownership,
        data: {
          status: 'cancelled',
          leaseId: null,
          leaseUntil: null,
          lastError:
            'The source file was removed or its access settings changed.',
        },
      })
      return
    }
  }
  let lastError =
    'Could not deliver webhook. Check the destination, network policy, and encryption key.'
  let permanent = false
  try {
    const secret = decryptSecret(current.webhook.secret, WEBHOOK_SECRET_PURPOSE)
    const status = await sendWebhook(
      current.webhook.url,
      secret,
      delivery.eventId,
      delivery.payload
    )
    if (status >= 200 && status < 300) {
      await prisma.webhookDelivery.updateMany({
        where: ownership,
        data: {
          status: 'delivered',
          deliveredAt: new Date(),
          lastError: null,
          leaseId: null,
          leaseUntil: null,
        },
      })
      return
    }
    lastError = `Destination returned HTTP ${status}.`
    permanent =
      status >= 300 && status < 500 && status !== 408 && status !== 429
  } catch {
    // Do not persist connection URLs, response bodies, secrets or SQL errors.
  }
  const retry = !permanent && delivery.attempts < WEBHOOK_MAX_ATTEMPTS
  await prisma.webhookDelivery.updateMany({
    where: ownership,
    data: {
      status: retry ? 'pending' : 'failed',
      availableAt: new Date(Date.now() + retryDelayMs(delivery.attempts)),
      lastError,
      leaseId: null,
      leaseUntil: null,
    },
  })
}
