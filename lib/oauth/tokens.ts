import type { Prisma } from '@prisma/client'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { setAuditActor, setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { hashApiToken } from '@/lib/integrations/tokens'

import { findClient } from './clients'
import {
  type RevokedReason,
  connectionKey,
  countLiveConnections,
  effectiveScopes,
  lockConnection,
  revokeConnection,
} from './connections'
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_SECONDS,
  MAX_CONNECTIONS,
  MAX_SUCCESSORS,
  PAIRS_PER_HOUR,
  REFRESH_TOKEN_DAYS,
  REFRESH_TOKEN_PREFIX,
  ROTATION_LEEWAY_SECONDS,
} from './constants'
import { OAuthError } from './http'
import { isMcpResource, sameResource, signInScopes } from './urls'

type Transaction = Prisma.TransactionClient

/** What the token endpoint answers a grant with (RFC 6749 section 5.1). */
export type TokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  /** What these tokens can do right now: the grant within the pair's ceiling. */
  scope: string
}

/** A pair's own limit; without one the connection's grant applies as it is. */
type Ceiling = { narrowed: boolean; scopes: string[] }

const AUDIT_TARGET = 'agent_connection'
const HOUR = 60 * 60_000

/** One answer for every code or refresh token that cannot be used, whatever the reason. */
const invalidGrant = () =>
  new OAuthError(
    'invalid_grant',
    'The code or refresh token is not valid, has expired or was already used. Sign in again.'
  )

function required(fields: URLSearchParams, name: string): string {
  const value = fields.get(name)
  if (!value)
    throw new OAuthError('invalid_request', `The ${name} parameter is missing.`)
  return value
}

/** Tokens are for the MCP endpoint only; a request may say so, and may say nothing else. */
function checkResource(fields: URLSearchParams, request: Request) {
  const resource = fields.get('resource')
  if (resource !== null && !isMcpResource(resource, request))
    throw new OAuthError(
      'invalid_target',
      'Tokens are issued only for the MCP endpoint of this Flare instance.'
    )
}

async function registeredClient(fields: URLSearchParams) {
  const client = await findClient(required(fields, 'client_id'))
  if (!client)
    throw new OAuthError(
      'invalid_client',
      'This client is not registered with this Flare instance. Register again.'
    )
  return client
}

/** 256 random bits behind a prefix that says what kind of secret it is. */
const newSecret = (prefix: string) =>
  prefix + randomBytes(32).toString('base64url')

/** Creates a token pair on a connection and answers it. Only digests are stored. */
async function issuePair(
  tx: Transaction,
  connection: { id: string; scopes: string[] },
  ceiling: Ceiling,
  parentId: string | null,
  now: Date
): Promise<TokenResponse> {
  const access = newSecret(ACCESS_TOKEN_PREFIX)
  const refresh = newSecret(REFRESH_TOKEN_PREFIX)
  await tx.agentToken.create({
    data: {
      connectionId: connection.id,
      accessHash: hashApiToken(access),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_SECONDS * 1000),
      refreshHash: hashApiToken(refresh),
      refreshExpiresAt: new Date(
        now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60_000
      ),
      narrowed: ceiling.narrowed,
      scopes: ceiling.scopes,
      parentId,
      // The same clock as the expiries, and as the hourly limit that counts by it.
      createdAt: now,
    },
  })
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refresh,
    scope: effectiveScopes(connection.scopes, ceiling).join(' '),
  }
}

/** RFC 7636: 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/

/** Whether a verifier is the one whose S256 challenge the code was issued for. */
function pkceMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(
    createHash('sha256').update(verifier).digest('base64url')
  )
  const expected = Buffer.from(challenge)
  return (
    computed.length === expected.length && timingSafeEqual(computed, expected)
  )
}

/** A refusal that ended a connection: recorded as a denial, with the connection as its target. */
function recordEnded(connection: { id: string; clientName: string }) {
  setAuditOutcome('denied')
  setAuditTarget({
    type: AUDIT_TARGET,
    id: connection.id,
    name: connection.clientName,
  })
}

/**
 * Redeems an authorization code for a new connection and its first token
 * pair. Everything happens in one transaction that the account's row lock
 * opens, so it takes turns with signing the account out everywhere. Claiming
 * the code's row decides which of two simultaneous requests wins. A code that
 * comes back after it was used ends the connection its first use made, and a
 * request that fails a check uses the code up: nobody gets a second guess.
 */
export async function exchangeCode(
  fields: URLSearchParams,
  request: Request
): Promise<TokenResponse> {
  const code = required(fields, 'code')
  const redirectUri = required(fields, 'redirect_uri')
  const verifier = required(fields, 'code_verifier')
  if (!VERIFIER.test(verifier))
    throw new OAuthError(
      'invalid_request',
      'code_verifier must be 43 to 128 letters, digits, "-", ".", "_" or "~".'
    )
  checkResource(fields, request)
  const client = await registeredClient(fields)
  const hash = hashApiToken(code)
  const issued = await prisma.oAuthCode.findUnique({
    where: { hash },
    select: { userId: true },
  })
  if (!issued) throw invalidGrant()

  const outcome = await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, issued.userId)
    const now = new Date()
    const { count } = await tx.oAuthCode.updateMany({
      where: { hash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    const row = await tx.oAuthCode.findUnique({
      where: { hash },
      include: { user: { select: { name: true, sessionVersion: true } } },
    })
    if (!row) return { refused: 'grant' as const }
    if (!count) {
      // Expired, or presented a second time. Whoever holds a used code may
      // not be who redeemed it, so what its first use made ends now.
      const first = row.usedAt && row.connectionId
      const connection = first
        ? await tx.agentConnection.findUnique({ where: { id: first } })
        : null
      const ended =
        connection !== null &&
        (await revokeConnection(tx, { id: connection.id }, 'code-reuse'))
      return { refused: 'grant' as const, ended: ended ? connection : null }
    }
    const resource = fields.get('resource')
    if (
      // Signing the account out everywhere deletes its codes. This holds
      // even if one outlived that: a code is good only for the session
      // version that approved it, read here under the account's lock.
      row.sessionVersion !== row.user.sessionVersion ||
      row.clientId !== client.id ||
      row.redirectUri !== redirectUri ||
      !pkceMatches(verifier, row.codeChallenge) ||
      (resource !== null && !sameResource(resource, row.resource))
    )
      return { refused: 'grant' as const }
    if ((await countLiveConnections(tx, row.userId, now)) >= MAX_CONNECTIONS)
      return { refused: 'limit' as const }
    // The code proves the account approved this; from here it is the actor.
    setAuditActor({ id: row.userId, name: row.user.name })
    const connection = await tx.agentConnection.create({
      data: {
        userId: row.userId,
        clientId: client.id,
        clientName: client.name,
        redirectUri: row.redirectUri,
        scopes: signInScopes(row.scopes),
      },
    })
    const tokens = await issuePair(
      tx,
      connection,
      { narrowed: false, scopes: [] },
      null,
      now
    )
    await tx.oAuthCode.update({
      where: { hash },
      data: { connectionId: connection.id },
    })
    return { tokens, connection, userName: row.user.name }
  })

  if ('refused' in outcome) {
    if (outcome.refused === 'limit')
      throw new OAuthError(
        'invalid_grant',
        `This account already has ${MAX_CONNECTIONS} connected agents. Disconnect one in Flare, then sign in again.`
      )
    if (outcome.ended) recordEnded(outcome.ended)
    throw invalidGrant()
  }
  const { connection } = outcome
  setAuditActor({
    id: connection.userId,
    name: outcome.userName,
    tokenId: connectionKey(connection.id),
  })
  setAuditTarget({
    type: AUDIT_TARGET,
    id: connection.id,
    name: connection.clientName,
  })
  return outcome.tokens
}

/**
 * Exchanges a refresh token for a new pair. A refresh token is used once:
 *
 * - Not used before: it is marked rotated and a successor pair is issued.
 * - Used less than a minute ago: another successor is issued, up to five in
 *   all. A response can be lost on the way, and two windows of one editor can
 *   share a stored token; each then holds a pair that works.
 * - Used longer ago: someone kept an old token. The connection ends, with
 *   every pair it had.
 *
 * A token that is used for the first time is refused with `429` once its
 * connection was issued 30 pairs in the last hour. Nothing is used up: the
 * same token works once there is room. Every pair is a row kept for 90
 * days, and without the limit a client that refreshed in a loop would add
 * one each time. A token used less than a minute ago is never refused for
 * that limit: its answer may not have arrived, and by the time there was
 * room it would be a replay. Those stay bounded by the five per token.
 *
 * `scope` narrows the successor to that set, which must be within what the
 * redeemed token could do; without it the successor keeps its predecessor's
 * ceiling. All of it is one transaction. It opens with the connection's row
 * lock, the lock everything that ends a connection takes first, so requests
 * for one connection take turns; the claim of the token's row then says
 * whether this request was the first to use it.
 */
export async function refreshTokens(
  fields: URLSearchParams,
  request: Request
): Promise<TokenResponse> {
  const presented = required(fields, 'refresh_token')
  checkResource(fields, request)
  const client = await registeredClient(fields)
  if (!presented.startsWith(REFRESH_TOKEN_PREFIX)) throw invalidGrant()
  const refreshHash = hashApiToken(presented)
  const requested = (fields.get('scope') ?? '').split(' ').filter(Boolean)
  const issued = await prisma.agentToken.findUnique({
    where: { refreshHash },
    select: { connectionId: true },
  })
  if (!issued) throw invalidGrant()

  const outcome = await prisma.$transaction(async (tx) => {
    await lockConnection(tx, issued.connectionId)
    // Read again under the lock: this is the token as it stands now.
    const token = await tx.agentToken.findUnique({
      where: { refreshHash },
      include: { connection: true },
    })
    const now = new Date()
    if (!token || token.connection.revokedAt)
      return { refused: 'grant' as const }
    const { connection } = token
    // An old token coming back is a replay whatever else the request says:
    // decided first, so a wrong client or scope beside it changes nothing.
    const usedAt = token.rotatedAt?.getTime()
    if (
      usedAt !== undefined &&
      now.getTime() - usedAt >= ROTATION_LEEWAY_SECONDS * 1000
    ) {
      await revokeConnection(tx, { id: connection.id }, 'replay')
      return { refused: 'replay' as const, connection }
    }
    if (
      token.refreshExpiresAt <= now ||
      // A token is bound to the client it was issued to.
      connection.clientId !== client.id
    )
      return { refused: 'grant' as const }
    let ceiling: Ceiling = { narrowed: token.narrowed, scopes: token.scopes }
    if (requested.length) {
      const held = effectiveScopes(connection.scopes, token)
      // Checked before the token is used up, so asking for too much costs nothing.
      if (!requested.every((scope) => held.includes(scope)))
        return { refused: 'scope' as const }
      ceiling = { narrowed: true, scopes: signInScopes(requested) }
    }
    // The hourly limit, for a token nobody used yet. Asked once the replay
    // and the grant are decided, so it hides neither, and before the token
    // is used up, so the token is still good when there is room. A token
    // used a moment ago is let past: telling its client to wait would turn
    // the retry of a lost answer into a replay.
    if (!token.rotatedAt) {
      const recent = await tx.agentToken.findMany({
        where: {
          connectionId: connection.id,
          createdAt: { gt: new Date(now.getTime() - HOUR) },
        },
        orderBy: { createdAt: 'asc' },
        take: PAIRS_PER_HOUR,
        select: { createdAt: true },
      })
      if (recent.length >= PAIRS_PER_HOUR)
        // There is room again when the oldest of them is an hour old.
        return {
          refused: 'limit' as const,
          retryAfter: Math.max(
            1,
            Math.ceil(
              (recent[0].createdAt.getTime() + HOUR - now.getTime()) / 1000
            )
          ),
        }
    }
    const { count } = await tx.agentToken.updateMany({
      where: { id: token.id, rotatedAt: null },
      data: { rotatedAt: now },
    })
    // Not the first to use it, but within the leeway: one more successor,
    // while there is room for one.
    if (
      !count &&
      (await tx.agentToken.count({ where: { parentId: token.id } })) >=
        MAX_SUCCESSORS
    )
      return { refused: 'grant' as const }
    return { tokens: await issuePair(tx, connection, ceiling, token.id, now) }
  })

  if (!('refused' in outcome)) return outcome.tokens
  if (outcome.refused === 'scope')
    throw new OAuthError(
      'invalid_scope',
      'scope asks for more than this refresh token was granted.'
    )
  if (outcome.refused === 'limit')
    // Not `invalid_grant`, which makes a client drop its tokens and send
    // the person to sign in again. After this answer it keeps them.
    throw new OAuthError(
      'temporarily_unavailable',
      'This connection refreshed its tokens too often in the last hour. Try again later.',
      429,
      { 'Retry-After': String(outcome.retryAfter) }
    )
  if (outcome.refused === 'replay') recordEnded(outcome.connection)
  throw invalidGrant()
}

/**
 * RFC 7009: ends the connection a refresh or access token belongs to, with
 * every pair it has. Holding any token of a connection is enough to end it,
 * and a token Flare does not know is answered the same way as one it revoked.
 */
export async function revokeByToken(token: string): Promise<void> {
  const hash = hashApiToken(token)
  const where = token.startsWith(ACCESS_TOKEN_PREFIX)
    ? { accessHash: hash }
    : token.startsWith(REFRESH_TOKEN_PREFIX)
      ? { refreshHash: hash }
      : null
  if (!where) return
  const pair = await prisma.agentToken.findUnique({
    where,
    select: {
      connection: {
        select: {
          id: true,
          clientName: true,
          userId: true,
          user: { select: { name: true } },
        },
      },
    },
  })
  if (!pair) return
  const { connection } = pair
  setAuditActor({
    id: connection.userId,
    name: connection.user.name,
    tokenId: connectionKey(connection.id),
  })
  setAuditTarget({
    type: AUDIT_TARGET,
    id: connection.id,
    name: connection.clientName,
  })
  const reason: RevokedReason = 'revoked'
  await prisma.$transaction((tx) =>
    revokeConnection(tx, { id: connection.id }, reason)
  )
}
