import { NextResponse } from 'next/server'

import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { encryptSecret } from '@/lib/email/crypto'
import { resolveWebhookTarget } from '@/lib/integrations/security'
import { API_SCOPES, createRandomApiToken } from '@/lib/integrations/tokens'
import {
  WEBHOOK_MAX_PENDING,
  WEBHOOK_MAX_PENDING_PER_USER,
  WEBHOOK_SECRET_PURPOSE,
} from '@/lib/integrations/webhooks'
import { isSameOriginRequest } from '@/lib/security/request-origin'

export const runtime = 'nodejs'
const name = z.string().trim().min(1).max(80)
const command = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create-token'),
      name,
      scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
      profileId: z.string().min(1).nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal('revoke-token'), id: z.string().min(1) })
    .strict(),
  z
    .object({
      action: z.literal('create-webhook'),
      name,
      url: z.string().max(2048),
    })
    .strict(),
  z
    .object({
      action: z.literal('toggle-webhook'),
      id: z.string().min(1),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({ action: z.literal('delete-webhook'), id: z.string().min(1) })
    .strict(),
  z
    .object({ action: z.literal('test-webhook'), id: z.string().min(1) })
    .strict(),
  z
    .object({ action: z.literal('retry-delivery'), id: z.string().min(1) })
    .strict(),
])
const tokenSelect = {
  id: true,
  name: true,
  scopes: true,
  profileId: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const
const webhookSelect = {
  id: true,
  name: true,
  url: true,
  enabled: true,
  createdAt: true,
} as const

export async function GET() {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to manage integrations.' },
      { status: 401 }
    )
  const userId = session.user.id
  const [tokens, webhooks, deliveries, profiles] = await Promise.all([
    prisma.apiToken.findMany({
      where: { userId },
      select: tokenSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.webhook.findMany({
      where: { userId },
      select: webhookSelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.webhookDelivery.findMany({
      where: { webhook: { userId } },
      select: {
        id: true,
        eventId: true,
        webhookId: true,
        status: true,
        attempts: true,
        availableAt: true,
        lastError: true,
        deliveredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.uploadProfile.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return NextResponse.json(
    { tokens, webhooks, deliveries, profiles },
    { headers: { 'cache-control': 'no-store' } }
  )
}

export async function POST(request: Request) {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Sign in to manage integrations.' },
      { status: 401 }
    )
  if (!isSameOriginRequest(request))
    return NextResponse.json(
      { error: 'Cross-origin changes are not allowed.' },
      { status: 403 }
    )
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json(
      { error: 'Use application/json.' },
      { status: 415 }
    )
  const userId = session.user.id
  try {
    const raw = await request.text()
    if (raw.length > 16_384)
      return NextResponse.json(
        { error: 'Request is too large.' },
        { status: 413 }
      )
    const parsed = command.safeParse(JSON.parse(raw))
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Check the integration settings and try again.' },
        { status: 400 }
      )
    const input = parsed.data
    if (input.action === 'create-webhook') {
      try {
        await resolveWebhookTarget(input.url)
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error ? error.message : 'Invalid destination.',
          },
          { status: 400 }
        )
      }
    }
    const result = await prisma.$transaction(async (tx) => {
      // Bound management changes across replicas, including test/retry admission.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347212, hashtext(${userId}))`
      if (input.action === 'create-token') {
        if (
          (await tx.apiToken.count({
            where: {
              userId,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          })) >= 50
        )
          return {
            error: 'Revoke an unused token before creating another (limit 50).',
          }
        if (
          input.profileId &&
          (!input.scopes.includes('files:upload') ||
            !(await tx.uploadProfile.findFirst({
              where: { id: input.profileId, userId },
            })))
        )
          return {
            error:
              'Choose one of your upload profiles and enable the upload scope.',
          }
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
        if (expiresAt && expiresAt <= new Date())
          return { error: 'Token expiration must be in the future.' }
        const generated = createRandomApiToken()
        const token = await tx.apiToken.create({
          data: {
            userId,
            name: input.name,
            hash: generated.hash,
            scopes: [...new Set(input.scopes)],
            profileId: input.profileId,
            expiresAt,
          },
          select: tokenSelect,
        })
        return { token, secret: generated.token, secretKind: 'token' }
      }
      if (input.action === 'revoke-token') {
        const result = await tx.apiToken.updateMany({
          where: { id: input.id, userId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        return result.count
          ? { ok: true }
          : { error: 'Token not found or already revoked.' }
      }
      if (input.action === 'create-webhook') {
        if ((await tx.webhook.count({ where: { userId } })) >= 10)
          return {
            error:
              'Delete an unused webhook before creating another (limit 10).',
          }
        const secret = 'whsec_' + randomBytes(32).toString('base64url')
        const webhook = await tx.webhook.create({
          data: {
            userId,
            name: input.name,
            url: input.url,
            secret: encryptSecret(secret, WEBHOOK_SECRET_PURPOSE),
          },
          select: webhookSelect,
        })
        return { webhook, secret, secretKind: 'webhook' }
      }
      if (input.action === 'retry-delivery') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347213, hashtext(${userId}))`
        const delivery = await tx.webhookDelivery.findFirst({
          where: {
            id: input.id,
            status: 'failed',
            webhook: { userId, enabled: true },
          },
        })
        if (!delivery)
          return {
            error:
              'Only failed deliveries for enabled webhooks can be retried.',
          }
        if (delivery.updatedAt.getTime() > Date.now() - 60_000)
          return { error: 'Wait one minute before retrying this delivery.' }
        const pending = { status: { in: ['pending', 'processing'] } }
        if (
          (await tx.webhookDelivery.count({
            where: { ...pending, webhookId: delivery.webhookId },
          })) >= WEBHOOK_MAX_PENDING ||
          (await tx.webhookDelivery.count({
            where: { ...pending, webhook: { userId } },
          })) >= WEBHOOK_MAX_PENDING_PER_USER
        )
          return {
            error:
              'Webhook queue is full. Wait for pending deliveries or pause a stalled webhook.',
          }
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'pending',
            attempts: 0,
            availableAt: new Date(),
            lastError: null,
            leaseId: null,
            leaseUntil: null,
          },
        })
        return { ok: true }
      }
      // Serialize pause/delete with enqueue so paused receivers cannot acquire
      // a new pending event after their existing queue was cancelled.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347213, hashtext(${userId}))`
      const webhook = await tx.webhook.findFirst({
        where: { id: input.id, userId },
      })
      if (!webhook) return { error: 'Webhook not found.' }
      if (input.action === 'delete-webhook') {
        await tx.webhook.delete({ where: { id: webhook.id } })
        return { ok: true }
      }
      if (input.action === 'toggle-webhook') {
        await tx.webhook.update({
          where: { id: webhook.id },
          data: { enabled: input.enabled },
        })
        if (!input.enabled)
          await tx.webhookDelivery.updateMany({
            where: {
              webhookId: webhook.id,
              status: { in: ['pending', 'processing'] },
            },
            data: { status: 'cancelled', leaseId: null, leaseUntil: null },
          })
        return { ok: true }
      }
      if (!webhook.enabled)
        return { error: 'Enable this webhook before sending a test.' }
      const pending = { status: { in: ['pending', 'processing'] } }
      if (
        (await tx.webhookDelivery.count({
          where: { ...pending, webhookId: webhook.id },
        })) >= WEBHOOK_MAX_PENDING ||
        (await tx.webhookDelivery.count({
          where: { ...pending, webhook: { userId } },
        })) >= WEBHOOK_MAX_PENDING_PER_USER
      )
        return {
          error:
            'Webhook queue is full. Wait for pending deliveries or pause a stalled webhook.',
        }
      if (
        (await tx.webhookDelivery.count({
          where: {
            webhookId: webhook.id,
            eventId: { startsWith: 'test:' },
            createdAt: { gt: new Date(Date.now() - 3_600_000) },
          },
        })) >= 10
      )
        return { error: 'Webhook test limit reached. Try again in an hour.' }
      const id = `test:${randomUUID()}`
      await tx.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          eventId: id,
          payload: {
            version: 1,
            id,
            type: 'file.ready',
            test: true,
            occurredAt: new Date().toISOString(),
            data: {
              id: 'example-file',
              name: 'example.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
              visibility: 'PUBLIC',
              passwordProtected: false,
            },
          },
        },
      })
      return { ok: true }
    })
    return NextResponse.json(result, {
      status: 'error' in result ? 400 : 200,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
    return NextResponse.json(
      {
        error:
          'Could not update integrations. Check the server database and encryption configuration.',
      },
      { status: 500 }
    )
  }
}
