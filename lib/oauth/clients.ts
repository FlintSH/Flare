import { randomBytes } from 'node:crypto'
import * as z from 'zod'

import { prisma } from '@/lib/database/prisma'
import { clientIp } from '@/lib/security/client-ip'
import { consumeLimit } from '@/lib/security/database-limit'

import {
  CLIENT_ID_PREFIX,
  MAX_CLIENT_NAME_LENGTH,
  MAX_REDIRECT_URIS,
  MAX_REDIRECT_URI_LENGTH,
  REGISTRATIONS_PER_HOUR,
} from './constants'
import { OAuthError } from './http'
import { issuer } from './urls'

export const DEFAULT_CLIENT_NAME = 'Unnamed client'

/** What Flare supports, and so what every registration is answered with. */
export const GRANT_TYPES = ['authorization_code', 'refresh_token'] as const
export const RESPONSE_TYPES = ['code'] as const

/** The hosts a browser reaches only on the computer it runs on. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Schemes no client may return to, in one place.
 *
 * A private scheme belongs to an app: `cursor://`, `vscode://`, `zed://`.
 * These belong to the browser or the operating system instead, and several
 * have handlers that act on what the address says: run a script, open a
 * file or a network share, install an app, start a search, a call or a
 * message. Flare is the page the person trusts at that moment, and it sends
 * the browser to the address when they choose Cancel as well as when they
 * choose Allow, so a client must not be able to make that address one of
 * these. `javascript:` would run on Flare's own page.
 *
 * It is a list of what is refused, because an app's scheme can be any word:
 * Cursor's has no dot in it.
 */
const REFUSED_SCHEMES = [
  // Handled by the browser itself.
  'javascript',
  'data',
  'file',
  'blob',
  'about',
  'vbscript',
  'view-source',
  'filesystem',
  'chrome',
  'chrome-extension',
  'moz-extension',
  'resource',
  'res',
  'jar',
  'ws',
  'wss',
  'ftp',
  // Handed to the operating system or an app that acts on the address: mail,
  // calls, messages, shares, shells, settings, automations, installers.
  'mailto',
  'tel',
  'sms',
  'facetime',
  'facetime-audio',
  'callto',
  'sip',
  'sips',
  'smb',
  'nfs',
  'afp',
  'ssh',
  'sftp',
  'telnet',
  'ldap',
  'ldaps',
  'shell',
  'search-ms',
  'microsoft-edge',
  'itms',
  'itms-apps',
  'itms-services',
  'shortcuts',
  'x-apple.systempreferences',
  'intent',
  'android-app',
  'steam',
  'vscode-webview',
]
/** Windows registers a family of these: `ms-msdt`, `ms-officecmd`, `ms-settings`. */
const REFUSED_SCHEME_PREFIXES = ['ms-']

const schemeRefused = (scheme: string) =>
  REFUSED_SCHEMES.includes(scheme) ||
  REFUSED_SCHEME_PREFIXES.some((prefix) => scheme.startsWith(prefix))

/**
 * The parameters Flare adds to a redirect address. One that already has any
 * of them would come back with two, and readers disagree on which counts.
 */
const ANSWER_PARAMETERS = [
  'code',
  'state',
  'iss',
  'error',
  'error_description',
  'error_uri',
]

function parsed(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const isLoopback = (url: URL) =>
  url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)

/**
 * Whether an address is on the origin Flare itself is served at: the same
 * scheme, host and port, however they are written. No client returns there.
 * The consent screen shows where a sign-in goes back to, and this instance's
 * own name is the one a person would trust without a second look, while a
 * short link or a shared file on it can lead anywhere.
 */
export function onOwnOrigin(redirectUri: string, issuer: string): boolean {
  const own = parsed(issuer)
  const url = parsed(redirectUri)
  if (!own || !url) return false
  // An instance served on this computer answers to every name of it.
  if (isLoopback(own) && isLoopback(url)) return own.port === url.port
  // Schemes without an origin of their own, an app's among them, say "null".
  if (url.origin === 'null') return false
  // A host name with a dot at its end is the same host.
  const place = ({ protocol, hostname, port }: URL) =>
    `${protocol}//${hostname.replace(/\.$/, '')}:${port}`
  return place(url) === place(own)
}

/**
 * Why a redirect address cannot be registered, or null when it can. Allowed:
 * `https` to any host but this instance's own; `http` only to this computer
 * (`localhost`, `127.0.0.1`, `[::1]`); and an app's private scheme such as
 * `cursor://` (RFC 8252). Never a fragment, credentials, a parameter Flare
 * adds itself, or a scheme the browser or the operating system handles.
 * `issuer` is the address this instance is served at.
 */
export function redirectUriProblem(
  value: string,
  issuer?: string
): string | null {
  if (value.length > MAX_REDIRECT_URI_LENGTH)
    return `A redirect URI is longer than ${MAX_REDIRECT_URI_LENGTH} characters.`
  // The URL parser drops tabs and line breaks and reads `\` as `/`, so an
  // address that holds them could read one way here and another elsewhere.
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value))
    return 'A redirect URI holds a space, a backslash or a control character.'
  if (value.includes('#')) return 'A redirect URI must not have a fragment.'
  const url = parsed(value)
  if (!url) return 'A redirect URI is not an absolute URL.'
  const taken = ANSWER_PARAMETERS.find((name) => url.searchParams.has(name))
  if (taken)
    return `A redirect URI must not have a "${taken}" parameter of its own: Flare adds one.`
  const scheme = url.protocol.slice(0, -1)
  if (scheme === 'https' || scheme === 'http') {
    if (!/^https?:\/\/[^/]/i.test(value))
      return 'A redirect URI is not an absolute URL.'
    if (url.username || url.password)
      return 'A redirect URI must not hold a user name or password.'
    if (issuer !== undefined && onOwnOrigin(value, issuer))
      return 'A redirect URI cannot be an address of this Flare instance.'
    if (scheme === 'http' && !isLoopback(url))
      return 'A redirect URI may use http only on localhost, 127.0.0.1 or [::1]. Use https.'
    return null
  }
  if (schemeRefused(scheme))
    return `A redirect URI cannot use the ${scheme} scheme.`
  return null
}

/**
 * Whether the redirect address a client presents is one it registered, and
 * one that could be registered today. The match is exact. The one exception
 * is RFC 8252's: a client listening on this computer picks a free port each
 * time, so for `http` on a loopback host the port is ignored. Host, path and
 * query still have to be the same.
 */
export function redirectMatches(
  registered: readonly string[],
  presented: string
): boolean {
  // The rules first, as they stand now, whatever was registered under them.
  if (redirectUriProblem(presented)) return false
  if (registered.includes(presented)) return true
  const url = parsed(presented)
  if (!url || !isLoopback(url)) return false
  const wanted = withoutPort(url)
  return registered.some((candidate) => {
    const known = parsed(candidate)
    return known !== null && isLoopback(known) && withoutPort(known) === wanted
  })
}

/** A URL as text with its port removed: everything else has to be the same. */
function withoutPort(url: URL): string {
  const copy = new URL(url.href)
  copy.port = ''
  return copy.href
}

/** A client's name as it is stored: one line of visible text, or the default. */
export function cleanClientName(name: string | null | undefined): string {
  const clean = (name ?? '')
    // Characters that draw nothing or reorder the text beside them.
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Z}]+/gu, ' ')
    .trim()
  // Counted in characters, not UTF-16 units, so no character is cut in half.
  return (
    [...clean].slice(0, MAX_CLIENT_NAME_LENGTH).join('').trim() ||
    DEFAULT_CLIENT_NAME
  )
}

const metadata = z.object({
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().nullish(),
  grant_types: z.array(z.string()).nullish(),
  response_types: z.array(z.string()).nullish(),
})

/**
 * What a registration asks for, as Flare will keep it (RFC 7591). Fields
 * Flare does not use are ignored, the asked-for client authentication among
 * them: every client is a public client.
 */
export function readRegistration(
  body: unknown,
  issuer?: string
): {
  name: string
  redirectUris: string[]
} {
  const result = metadata.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    if (issue?.path[0] === 'redirect_uris')
      throw new OAuthError(
        'invalid_redirect_uri',
        `redirect_uris must list between 1 and ${MAX_REDIRECT_URIS} redirect URIs.`
      )
    throw new OAuthError(
      'invalid_client_metadata',
      issue?.path.length
        ? `${String(issue.path[0])} is not valid.`
        : 'The registration must be a JSON object.'
    )
  }
  const { redirect_uris, client_name, grant_types, response_types } =
    result.data
  for (const uri of redirect_uris) {
    const problem = redirectUriProblem(uri, issuer)
    if (problem) throw new OAuthError('invalid_redirect_uri', problem)
  }
  if (grant_types && !grant_types.includes('authorization_code'))
    throw new OAuthError(
      'invalid_client_metadata',
      'grant_types must include authorization_code.'
    )
  if (response_types && !response_types.includes('code'))
    throw new OAuthError(
      'invalid_client_metadata',
      'response_types must include code.'
    )
  return {
    name: cleanClientName(client_name),
    redirectUris: [...new Set(redirect_uris)],
  }
}

/** The host a registration's limit is counted under: where it returns to. */
function redirectHost(uri: string): string {
  const url = parsed(uri)
  if (!url) return 'unknown'
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.hostname
    : url.protocol
}

const HOUR = 60 * 60

/**
 * Counts one registration. The limit is per client address and redirect
 * host, so people behind one cloud client's addresses do not share an
 * allowance with everything else there. A second, wider limit per address
 * alone keeps one sender from getting a fresh allowance by naming a new host
 * each time. Both are counted in the database, so they hold across restarts
 * and processes.
 */
async function limitRegistration(request: Request, redirectUri: string) {
  const address = clientIp(request.headers) ?? 'unknown'
  const limits = [
    {
      key: `oauth-register:${address}:${redirectHost(redirectUri)}`,
      limit: REGISTRATIONS_PER_HOUR,
    },
    {
      key: `oauth-register:${address}`,
      limit: REGISTRATIONS_PER_HOUR * 10,
    },
  ]
  for (const { key, limit } of limits) {
    const { allowed, resetsIn } = await consumeLimit(
      'AuthRateLimit',
      key,
      limit,
      HOUR
    )
    if (!allowed)
      throw new OAuthError(
        'temporarily_unavailable',
        'Too many registrations from this address. Try again later.',
        429,
        { 'Retry-After': String(Math.max(1, resetsIn)) }
      )
  }
}

/** Whether a value is written like a `client_id`, before anything looks it up. */
export function isClientId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(CLIENT_ID_PREFIX) &&
    /^[A-Za-z0-9_-]{43}$/.test(value.slice(CLIENT_ID_PREFIX.length))
  )
}

/** The registered client a `client_id` names, or null. */
export async function findClient(clientId: unknown) {
  if (!isClientId(clientId)) return null
  return prisma.oAuthClient.findUnique({ where: { id: clientId } })
}

/**
 * Registers a client (RFC 7591) and answers what was registered. The name
 * and addresses are the client's own claim; the consent screen shows them as
 * that.
 */
export async function registerClient(request: Request, body: unknown) {
  const { name, redirectUris } = readRegistration(body, issuer(request))
  await limitRegistration(request, redirectUris[0])
  const client = await prisma.oAuthClient.create({
    data: {
      id: CLIENT_ID_PREFIX + randomBytes(32).toString('base64url'),
      name,
      redirectUris,
    },
  })
  return {
    client_id: client.id,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: [...GRANT_TYPES],
    response_types: [...RESPONSE_TYPES],
    token_endpoint_auth_method: 'none',
  }
}
