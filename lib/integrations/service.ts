import type { Prisma } from '@prisma/client'
import { z } from 'zod'

import { readConfig } from '@/lib/config'
import { lockIntegrationChanges, lockWebhookQueue } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { scopeAvailable } from '@/lib/mcp/catalog'
import { mcpEnabled } from '@/lib/mcp/settings'
import {
  type Permission,
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'
import { publicOrigin } from '@/lib/security/public-origin'
import { encryptSecret } from '@/lib/security/secret-box'
import { findOwnedProfile } from '@/lib/uploads/profiles'

import {
  API_SCOPES,
  API_SCOPE_CATALOG,
  type ApiScope,
  MCP_SCOPE,
  scopeWorksOverApi,
} from './bearer-routes'
import { CONNECTION_NAME_MAX_LENGTH, WEBHOOK_URL_MAX_LENGTH } from './limits'
import { resolveWebhookTarget } from './security'
import { createRandomApiToken, createWebhookSecret } from './tokens'
import {
  TEST_EVENT_PREFIX,
  WEBHOOK_SECRET_PURPOSE,
  testEventPayload,
  webhooksWithQueueRoom,
} from './webhooks'

const MAX_ACTIVE_TOKENS = 50
const MAX_WEBHOOKS = 10
const TESTS_PER_HOUR = 10

/** A command the account's integrations refuse. Like every command result, it is never cached. */
export class IntegrationError extends HttpError {
  constructor(message: string) {
    super(400, message, { headers: { 'cache-control': 'no-store' } })
    this.name = 'IntegrationError'
  }
}

const name = z.string().trim().min(1).max(CONNECTION_NAME_MAX_LENGTH)
const createTokenCommand = z
  .object({
    action: z.literal('create-token'),
    name,
    scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
    profileId: z.string().min(1).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
const createWebhookCommand = z
  .object({
    action: z.literal('create-webhook'),
    name,
    url: z.string().max(WEBHOOK_URL_MAX_LENGTH),
  })
  .strict()
const integrationCommand = z.discriminatedUnion('action', [
  createTokenCommand,
  z
    .object({ action: z.literal('revoke-token'), id: z.string().min(1) })
    .strict(),
  createWebhookCommand,
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

const commandPermission = {
  'create-token': 'tokens.manage',
  'revoke-token': 'tokens.manage',
  'create-webhook': 'webhooks.manage',
  'toggle-webhook': 'webhooks.manage',
  'delete-webhook': 'webhooks.manage',
  'test-webhook': 'webhooks.manage',
  'retry-delivery': 'webhooks.manage',
} satisfies Record<z.infer<typeof integrationCommand>['action'], Permission>

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

type Account = { id: string } & PermissionSubject
type Transaction = Prisma.TransactionClient

/**
 * Whether agents can connect, and the address they connect to: the public
 * address, or null for the browser's own when none is configured. While the
 * MCP server is off the screen shows nothing about agents, so no address.
 */
async function agentAccess() {
  const enabled = await mcpEnabled()
  const origin = enabled ? publicOrigin() : null
  return {
    enabled,
    url: origin ? `${origin.href.replace(/\/+$/, '')}/api/mcp` : null,
  }
}

/** The integrations screen. An account sees each list only while it may manage it. */
export async function listIntegrations(account: Account) {
  const userId = account.id
  const managesTokens = hasPermission(account, 'tokens.manage')
  const managesWebhooks = hasPermission(account, 'webhooks.manage')
  const [tokens, webhooks, deliveries, profiles, mcp] = await Promise.all([
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
    // Agents connect with tokens, so only an account that manages them is told.
    managesTokens ? agentAccess() : undefined,
  ])
  return {
    tokens: managesTokens ? tokens : [],
    webhooks: managesWebhooks ? webhooks : [],
    deliveries: managesWebhooks ? deliveries : [],
    profiles: managesTokens ? profiles : [],
    ...(mcp && { mcp }),
  }
}

/**
 * Run one command from the integrations screen. A created token or webhook
 * comes back with its secret, which is never shown again.
 */
export async function runIntegrationCommand(account: Account, body: unknown) {
  const parsed = integrationCommand.safeParse(body)
  if (!parsed.success)
    throw new HttpError(400, 'Check the integration settings and try again.')
  const command = parsed.data
  if (!hasPermission(account, commandPermission[command.action]))
    throw new HttpError(
      403,
      'You do not have permission to perform this action.'
    )
  // Resolve DNS before taking the account's locks.
  if (command.action === 'create-webhook')
    await resolveWebhookTarget(command.url)
  const userId = account.id
  return prisma.$transaction(async (tx) => {
    // Bound management changes across replicas, including test/retry admission.
    await lockIntegrationChanges(tx, userId)
    switch (command.action) {
      case 'create-token':
        return createToken(tx, account, command)
      case 'revoke-token':
        return revokeToken(tx, userId, command.id)
      case 'create-webhook':
        return createWebhook(tx, userId, command)
      case 'toggle-webhook':
        return toggleWebhook(tx, userId, command.id, command.enabled)
      case 'delete-webhook':
        return deleteWebhook(tx, userId, command.id)
      case 'test-webhook':
        return testWebhook(tx, userId, command.id)
      case 'retry-delivery':
        return retryDelivery(tx, userId, command.id)
    }
  })
}

const scopeLabels = (scopes: readonly ApiScope[]) =>
  scopes
    .map(
      (scope) =>
        `"${API_SCOPE_CATALOG.find((entry) => entry.scope === scope)?.label ?? scope}"`
    )
    .join(', ')

/**
 * The rules for a token agents can use: one that carries Agent access or a
 * scope only the MCP server honors. Such a token exists only while the server
 * is on, always carries Agent access, and holds nothing the account's role
 * cannot use right now, as the form offers them. A token made only of REST
 * scopes never comes here, so those are created exactly as before.
 */
async function assertAgentScopes(
  tx: Transaction,
  account: Account,
  scopes: readonly ApiScope[]
) {
  const agentOnly = scopes.filter(
    (scope) => scope !== MCP_SCOPE && !scopeWorksOverApi(scope)
  )
  if (!scopes.includes(MCP_SCOPE) && !agentOnly.length) return
  if (!(await readConfig(tx)).settings.general.mcp.enabled)
    throw new IntegrationError(
      'The MCP server is turned off on this instance, so tokens cannot have Agent access.'
    )
  if (!scopes.includes(MCP_SCOPE))
    throw new IntegrationError(
      `Agent access is needed for ${scopeLabels(agentOnly)}. Enable Agent access on the token, or remove ${agentOnly.length === 1 ? 'it' : 'them'}.`
    )
  const unavailable = scopes.filter(
    (scope) =>
      !scopeAvailable(
        scope,
        (permission) => hasPermission(account, permission),
        true
      )
  )
  if (unavailable.length)
    throw new IntegrationError(
      `Your role does not allow ${scopeLabels(unavailable)}. Remove ${unavailable.length === 1 ? 'it' : 'them'} and try again.`
    )
}

async function createToken(
  tx: Transaction,
  account: Account,
  input: z.infer<typeof createTokenCommand>
) {
  const userId = account.id
  await assertAgentScopes(tx, account, input.scopes)
  const active = await tx.apiToken.count({
    where: {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (active >= MAX_ACTIVE_TOKENS)
    throw new IntegrationError(
      `Revoke an unused token before creating another (limit ${MAX_ACTIVE_TOKENS}).`
    )
  if (input.profileId) {
    const unusable = () =>
      new IntegrationError(
        'Choose one of your upload profiles and enable the upload scope.'
      )
    if (!input.scopes.includes('files:upload')) throw unusable()
    await findOwnedProfile(tx, userId, input.profileId, unusable)
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && expiresAt <= new Date())
    throw new IntegrationError('Token expiration must be in the future.')
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

async function revokeToken(tx: Transaction, userId: string, id: string) {
  const { count } = await tx.apiToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (!count) throw new IntegrationError('Token not found or already revoked.')
  return { ok: true }
}

async function createWebhook(
  tx: Transaction,
  userId: string,
  input: z.infer<typeof createWebhookCommand>
) {
  if ((await tx.webhook.count({ where: { userId } })) >= MAX_WEBHOOKS)
    throw new IntegrationError(
      `Delete an unused webhook before creating another (limit ${MAX_WEBHOOKS}).`
    )
  const secret = createWebhookSecret()
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

async function ownedWebhook(tx: Transaction, userId: string, id: string) {
  // Serialize pause/delete with enqueue so paused receivers cannot acquire
  // a new pending event after their existing queue was cancelled.
  await lockWebhookQueue(tx, userId)
  const webhook = await tx.webhook.findFirst({ where: { id, userId } })
  if (!webhook) throw new IntegrationError('Webhook not found.')
  return webhook
}

async function toggleWebhook(
  tx: Transaction,
  userId: string,
  id: string,
  enabled: boolean
) {
  const webhook = await ownedWebhook(tx, userId, id)
  await tx.webhook.update({ where: { id: webhook.id }, data: { enabled } })
  if (!enabled)
    await tx.webhookDelivery.updateMany({
      where: {
        webhookId: webhook.id,
        status: { in: ['pending', 'processing'] },
      },
      data: { status: 'cancelled', leaseId: null, leaseUntil: null },
    })
  return { ok: true }
}

async function deleteWebhook(tx: Transaction, userId: string, id: string) {
  const webhook = await ownedWebhook(tx, userId, id)
  await tx.webhook.delete({ where: { id: webhook.id } })
  return { ok: true }
}

async function assertQueueRoom(
  tx: Transaction,
  userId: string,
  webhookId: string
) {
  if (!(await webhooksWithQueueRoom(tx, userId, [webhookId])).length)
    throw new IntegrationError(
      'Webhook queue is full. Wait for pending deliveries or pause a stalled webhook.'
    )
}

async function testWebhook(tx: Transaction, userId: string, id: string) {
  const webhook = await ownedWebhook(tx, userId, id)
  if (!webhook.enabled)
    throw new IntegrationError('Enable this webhook before sending a test.')
  await assertQueueRoom(tx, userId, webhook.id)
  const recentTests = await tx.webhookDelivery.count({
    where: {
      webhookId: webhook.id,
      eventId: { startsWith: TEST_EVENT_PREFIX },
      createdAt: { gt: new Date(Date.now() - 3_600_000) },
    },
  })
  if (recentTests >= TESTS_PER_HOUR)
    throw new IntegrationError(
      'Webhook test limit reached. Try again in an hour.'
    )
  const payload = testEventPayload()
  await tx.webhookDelivery.create({
    data: { webhookId: webhook.id, eventId: payload.id, payload },
  })
  return { ok: true }
}

async function retryDelivery(tx: Transaction, userId: string, id: string) {
  await lockWebhookQueue(tx, userId)
  const delivery = await tx.webhookDelivery.findFirst({
    where: { id, status: 'failed', webhook: { userId, enabled: true } },
  })
  if (!delivery)
    throw new IntegrationError(
      'Only failed deliveries for enabled webhooks can be retried.'
    )
  if (delivery.updatedAt.getTime() > Date.now() - 60_000)
    throw new IntegrationError('Wait one minute before retrying this delivery.')
  await assertQueueRoom(tx, userId, delivery.webhookId)
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
