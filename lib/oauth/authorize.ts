import type { OAuthClient } from '@prisma/client'
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { lockSettings, lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { AccessError, HttpError } from '@/lib/http/errors'
import {
  API_SCOPE_CATALOG,
  isAdminScope,
} from '@/lib/integrations/bearer-routes'
import { hashApiToken } from '@/lib/integrations/tokens'
import { scopeAvailable } from '@/lib/mcp/catalog'
import { administrationOn } from '@/lib/mcp/settings'
import {
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'
import { newLinkToken } from '@/lib/security/link-token'

import { findClient, onOwnOrigin, redirectMatches } from './clients'
import { countLiveConnections } from './connections'
import {
  CODE_SECONDS,
  MAX_CONNECTIONS,
  MAX_STATE_LENGTH,
  PENDING_SECONDS,
} from './constants'
import { SIGN_IN_SCOPES, isMcpResource, issuer, mcpResource } from './urls'

/** A sign-in request that passed every check, ready to show the person. */
export type AuthorizeRequest = {
  client: OAuthClient
  redirectUri: string
  codeChallenge: string
  state: string | null
  resource: string
  /** The most the person may grant: what the client asked for, or everything. */
  scopeCeiling: string[]
}

/**
 * Why a sign-in request cannot go on, as a sentence for the person. Every
 * refusal before the consent screen is shown on a page and never sent to the
 * client: anyone can register a client, so its address is not a place to send
 * someone who has not chosen to go there.
 */
export type AuthorizeRefusal = { page: string }

const RECONNECT = 'Go back to the app and connect again.'
const refusal = (what: string): AuthorizeRefusal => ({
  page: `${what} ${RECONNECT}`,
})
/** A request, or a part of one, too long to keep while the person signs in. */
export const TOO_LONG = refusal(
  'The app sent a sign-in request that is too long.'
)

/** A parameter's one value, null when absent, and `false` when it is sent twice. */
function single(query: URLSearchParams, name: string): string | null | false {
  const values = query.getAll(name)
  return values.length > 1 ? false : (values[0] ?? null)
}

/** An S256 challenge: the base64url of a SHA-256 digest, 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/**
 * Checks a sign-in request from scratch: the client and its redirect address
 * first, then everything else it says. Whatever is wrong, the answer is a
 * sentence for a page. Nothing here redirects anywhere.
 */
export async function validateAuthorize(
  query: URLSearchParams,
  request: Request
): Promise<AuthorizeRequest | AuthorizeRefusal> {
  const client = await findClient(single(query, 'client_id'))
  if (!client)
    // A registration nobody approved within a day is removed, and an app can
    // go on sending the client_id it remembers: say how to get past that.
    return {
      page: `The app that sent you here is not registered with this Flare instance. ${RECONNECT} If this page comes back, remove Flare from the app and add it again.`,
    }
  const redirectUri = single(query, 'redirect_uri')
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri))
    return refusal(
      'The app asked Flare to send you back to an address it did not register.'
    )
  // Checked again here: registration refuses it, but the address this
  // instance is served at can change afterwards, and a local client's port
  // is chosen per sign-in.
  if (onOwnOrigin(redirectUri, issuer(request)))
    return refusal(
      'The app asked Flare to send you back to this Flare instance itself.'
    )

  const state = single(query, 'state')
  const scope = single(query, 'scope')
  const codeChallenge = single(query, 'code_challenge')
  const method = single(query, 'code_challenge_method')
  const responseType = single(query, 'response_type')
  // OAuth forbids repeating a parameter, and choosing one of two values
  // would let a request mean different things to different readers.
  if ([state, scope, codeChallenge, method, responseType].includes(false))
    return refusal('The app sent part of its sign-in request twice.')
  if (typeof state === 'string' && state.length > MAX_STATE_LENGTH)
    return TOO_LONG
  if (responseType !== 'code')
    return refusal('The app asked for a kind of sign-in Flare does not offer.')
  // Without a stated method a challenge means plain, which proves nothing.
  if (
    method !== 'S256' ||
    typeof codeChallenge !== 'string' ||
    !CHALLENGE.test(codeChallenge)
  )
    return refusal(
      'The app left out a security check Flare requires (PKCE with S256).'
    )
  // Tokens are for the MCP endpoint; a client may name it, or nothing.
  if (query.getAll('resource').some((value) => !isMcpResource(value, request)))
    return refusal(
      'The app asked for access to something other than this Flare instance.'
    )
  // Scopes Flare does not have are dropped. Asking for none of its scopes
  // leaves the choice to the person.
  const asked = SIGN_IN_SCOPES.filter((candidate) =>
    (typeof scope === 'string' ? scope : '').split(' ').includes(candidate)
  )
  return {
    client,
    redirectUri,
    codeChallenge,
    // As the client sent it, to be handed back unchanged.
    state: typeof state === 'string' ? state : null,
    resource: mcpResource(request),
    scopeCeiling: asked.length ? asked : [...SIGN_IN_SCOPES],
  }
}

/**
 * What the consent screen is handed: the checked request, the account it was
 * checked for, and when it stops being accepted. `exp` is in seconds since
 * the epoch.
 */
const consentRequest = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  state: z.string().nullable(),
  resource: z.string(),
  scopeCeiling: z.array(z.string()),
  userId: z.string(),
  exp: z.number(),
})
export type ConsentRequest = z.infer<typeof consentRequest>

let consentKey: { secret: string; key: Buffer } | undefined

/** A key for signing consent requests and nothing else, derived from the session secret. */
function signingKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret)
    throw new Error('NEXTAUTH_SECRET must be set for agents to sign in.')
  if (consentKey?.secret !== secret)
    consentKey = {
      secret,
      key: Buffer.from(
        hkdfSync('sha256', secret, 'flare-oauth-v1', 'consent', 32)
      ),
    }
  return consentKey.key
}

const sign = (payload: string) =>
  createHmac('sha256', signingKey()).update(payload).digest()

/**
 * The request as the consent screen's `request` parameter: its JSON in
 * base64url, a dot, and an HMAC-SHA256 over that base64url text. The screen
 * can read it; only Flare can have written it.
 */
export function signConsentRequest(
  request: AuthorizeRequest,
  userId: string,
  now = Date.now()
): string {
  const payload = Buffer.from(
    JSON.stringify({
      clientId: request.client.id,
      clientName: request.client.name,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      state: request.state,
      resource: request.resource,
      scopeCeiling: request.scopeCeiling,
      userId,
      exp: Math.floor(now / 1000) + PENDING_SECONDS,
    } satisfies ConsentRequest)
  ).toString('base64url')
  return `${payload}.${sign(payload).toString('base64url')}`
}

/**
 * The request a consent blob carries, or null unless Flare signed exactly
 * this text and it has not expired. Whose request it is stays for the caller
 * to check against the session.
 */
export function readConsentRequest(
  blob: string,
  now = Date.now()
): ConsentRequest | null {
  const [payload, signature, ...rest] = blob.split('.')
  if (!payload || !signature || rest.length) return null
  const given = Buffer.from(signature, 'base64url')
  const expected = sign(payload)
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = consentRequest.safeParse(value)
  return parsed.success && parsed.data.exp * 1000 > now ? parsed.data : null
}

export const consentDecision = z.object({
  request: z.string().min(1).max(8192),
  decision: z.enum(['approve', 'deny']),
  scopes: z.array(z.string().max(64)).max(64).default([]),
})

const scopeLabels = (scopes: readonly string[]) =>
  scopes
    .map(
      (scope) =>
        `"${API_SCOPE_CATALOG.find((entry) => entry.scope === scope)?.label ?? scope}"`
    )
    .join(', ')

const refused = (message: string) => new HttpError(400, message)

/**
 * The client's redirect address with the answer's parameters added, and the
 * issuer with them (RFC 9207).
 *
 * This is the only place Flare builds an address of a client to send a
 * browser to, and it is called in exactly two cases, both from the consent
 * decision of a signed-in person: with a code when they approved, and with
 * `access_denied` when they cancelled. Nothing before the consent screen
 * redirects to a client, whatever is wrong with its request: anyone can
 * register a client, and a link to Flare must not be a way to land people on
 * an address a stranger registered.
 *
 * The address is used byte for byte as the client sent it, with the answer
 * appended to its query. Parsing and writing it again would change it:
 * a `%20` in a registered query comes back as `+`. It has no fragment, and
 * none of its own parameters has the name of one added here; registration
 * refuses both.
 */
function clientRedirect(
  request: Request,
  consent: ConsentRequest,
  parameters: Record<string, string>
): string {
  const answer = new URLSearchParams({
    ...parameters,
    ...(consent.state !== null && { state: consent.state }),
    iss: issuer(request),
  })
  const address = consent.redirectUri
  const joint = !address.includes('?')
    ? '?'
    : address.endsWith('?') || address.endsWith('&')
      ? ''
      : '&'
  return `${address}${joint}${answer}`
}

/**
 * The person's answer on the consent screen. Denying sends the client back
 * with `access_denied`. Approving needs the permission that creating a token
 * needs, scopes within what the client asked for and what the account's role
 * can use, and room for another connection; it then creates the code the
 * client redeems, bound to everything the request named, and answers where
 * to send the browser. The code is stored as a digest and never logged.
 * An `admin:*` scope is granted only while administration through MCP is
 * on, and this is one of the two places it can be: the other is creating a
 * named token. Editing a connection later never adds one.
 *
 * `user.sessionVersion` is the version of the session that sent the answer.
 * The code is created under the account's row lock, and only while the
 * account is still on that version: signing out everywhere takes the same
 * lock, deletes the account's codes and moves the version on, so an answer
 * sent before it and written after it creates nothing. The code records the
 * version, and redeeming it checks once more.
 */
export async function decideConsent(
  user: { id: string; sessionVersion: number } & PermissionSubject,
  input: z.infer<typeof consentDecision>,
  request: Request
): Promise<{ redirect: string }> {
  const consent = readConsentRequest(input.request)
  if (!consent) throw refused(`This sign-in request has expired. ${RECONNECT}`)
  // A request checked for one account is of no use to another.
  if (consent.userId !== user.id)
    throw refused(
      `This sign-in request was started with another Flare account. ${RECONNECT}`
    )
  setAuditTarget({
    type: 'oauth_client',
    id: consent.clientId,
    name: consent.clientName,
  })
  if (input.decision === 'deny')
    return {
      redirect: clientRedirect(request, consent, {
        error: 'access_denied',
        error_description: 'The person declined to connect this app.',
      }),
    }

  if (!hasPermission(user, 'tokens.manage'))
    throw new AccessError(403, 'Your role does not allow connecting agents.')
  const scopes = SIGN_IN_SCOPES.filter((scope) => input.scopes.includes(scope))
  // Anything outside what the client asked for, and anything a sign-in never
  // grants: the marker for named tokens, or a scope that does not exist.
  const beyond = input.scopes.filter(
    (scope) => !consent.scopeCeiling.includes(scope) || !scopes.includes(scope)
  )
  if (beyond.length)
    throw refused(
      `This sign-in cannot grant ${scopeLabels(beyond)}. Remove ${beyond.length === 1 ? 'it' : 'them'} and try again.`
    )
  if (!scopes.length) throw refused('Choose at least one permission.')
  // Read only when it matters: administration scopes exist only while it is
  // on. Read again under the settings lock below, before the code is made.
  const admin = scopes.filter(isAdminScope)
  const administrationOff = () =>
    refused(
      `Administration through MCP is turned off on this instance, so agents cannot have ${scopeLabels(admin)}. Remove ${admin.length === 1 ? 'it' : 'them'} and try again.`
    )
  const administration = admin.length > 0 && (await administrationOn())
  if (admin.length && !administration) throw administrationOff()
  const unavailable = scopes.filter(
    (scope) =>
      !scopeAvailable(
        scope,
        (permission) => hasPermission(user, permission),
        true,
        administration
      )
  )
  if (unavailable.length)
    throw refused(
      `Your role does not allow ${scopeLabels(unavailable)}. Remove ${unavailable.length === 1 ? 'it' : 'them'} and try again.`
    )
  // Told to the person now; redeeming the code counts again under a lock.
  if ((await countLiveConnections(prisma, user.id)) >= MAX_CONNECTIONS)
    throw refused(
      `This account already has ${MAX_CONNECTIONS} connected agents. Disconnect one you no longer use, then connect again.`
    )

  const code = newLinkToken()
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    // An administration grant takes turns with the switch: the settings
    // lock comes first, before the account's row, and the setting is read
    // as saved. Turning administration off then either commits first and
    // refuses this, or waits and strips the code this makes.
    if (admin.length) {
      await lockSettings(tx)
      if (!(await administrationOn(tx))) throw administrationOff()
    }
    await lockUserRow(tx, user.id)
    const account = await tx.user.findUnique({
      where: { id: user.id },
      select: { sessionVersion: true },
    })
    if (account?.sessionVersion !== user.sessionVersion)
      throw new AccessError(401, 'Sign in again to continue.')
    // Approving is what makes a registration count as used. One that was
    // removed in the meantime cannot be given a code.
    const { count } = await tx.oAuthClient.updateMany({
      where: { id: consent.clientId, usedAt: null },
      data: { usedAt: now },
    })
    if (
      !count &&
      !(await tx.oAuthClient.findUnique({
        where: { id: consent.clientId },
        select: { id: true },
      }))
    )
      throw refused(`The app's registration has expired. ${RECONNECT}`)
    await tx.oAuthCode.create({
      data: {
        hash: hashApiToken(code),
        clientId: consent.clientId,
        userId: user.id,
        redirectUri: consent.redirectUri,
        codeChallenge: consent.codeChallenge,
        resource: consent.resource,
        scopes,
        sessionVersion: account.sessionVersion,
        expiresAt: new Date(now.getTime() + CODE_SECONDS * 1000),
      },
    })
  })
  return { redirect: clientRedirect(request, consent, { code }) }
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!
  )

/**
 * The page a person sees when a sign-in cannot even be sent back to the app
 * that started it. It is static: no script, nothing loaded, never framed,
 * and it links nowhere.
 */
export function errorPage(message: string): Response {
  const title = 'This sign-in cannot continue'
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Flare</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f8fafc;color:#0f172a}
main{max-width:28rem;padding:2rem}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{margin:0;color:#475569}
@media (prefers-color-scheme:dark){body{background:#0b1220;color:#e2e8f0}p{color:#94a3b8}}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`,
    {
      status: 400,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  )
}
