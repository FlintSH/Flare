import { MCP_SCOPE } from '@/lib/integrations/bearer-routes'
import { MCP_SCOPES } from '@/lib/mcp/catalog'
import { publicOrigin } from '@/lib/security/public-origin'

import { AUTHORIZE_PATH } from './constants'

/**
 * Who issues the tokens: Flare's public address without a trailing slash, as
 * every generated link uses it. It comes from NEXTAUTH_URL, and from the
 * request only when that is not set.
 */
export function issuer(request: Request): string {
  return (publicOrigin()?.href ?? new URL(request.url).origin).replace(
    /\/+$/,
    ''
  )
}

/** The one resource tokens are for: the MCP endpoint, exactly as clients connect to it. */
export function mcpResource(request: Request): string {
  return `${issuer(request)}/api/mcp`
}

/**
 * A resource URL as it is compared: scheme, host and port the way a URL
 * parser writes them, and the path without a trailing slash. Null for
 * anything with a query, a fragment or credentials, or that is not a URL.
 */
function comparable(resource: string): string | null {
  let url: URL
  try {
    url = new URL(resource)
  } catch {
    return null
  }
  if (url.search || url.hash || url.username || url.password) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Whether two `resource` values name the same place. */
export function sameResource(one: string, other: string): boolean {
  const value = comparable(one)
  return value !== null && value === comparable(other)
}

/**
 * Whether a `resource` parameter names the MCP endpoint. A trailing slash and
 * the spelling of the host are the only differences allowed.
 */
export function isMcpResource(value: string, request: Request): boolean {
  return sameResource(value, mcpResource(request))
}

/**
 * The scopes a sign-in can grant, in catalog order: everything the MCP server
 * honors except the marker, which says only that a named token may be used
 * there.
 */
export const SIGN_IN_SCOPES: readonly string[] = MCP_SCOPES.filter(
  (scope) => scope !== MCP_SCOPE
)

/** `scopes` as the catalog orders them, without anything a sign-in cannot grant. */
export function signInScopes(scopes: readonly string[]): string[] {
  return SIGN_IN_SCOPES.filter((scope) => scopes.includes(scope))
}

/** Where a client reads what protects the MCP endpoint (RFC 9728). */
export function resourceMetadataUrl(request: Request): string {
  return `${issuer(request)}/.well-known/oauth-protected-resource/api/mcp`
}

/**
 * The challenge on a 401 from the MCP endpoint. It is what starts sign-in:
 * a client follows `resource_metadata` to the authorization server. It names
 * no scope on purpose. A client that copied one into its request would cap
 * what the consent screen can offer, and what an agent may do is for the
 * person to choose there, from everything their role allows.
 *
 * `refused` says the request did carry a bearer token and it was not
 * accepted: expired, revoked, unknown, or not one for this endpoint. RFC 6750
 * names that `invalid_token`, which tells a client to refresh or sign in
 * again instead of sending the same token once more. A request that carried
 * none gets the bare challenge.
 */
export function bearerChallenge(request: Request, refused = false): string {
  return `Bearer ${refused ? 'error="invalid_token", ' : ''}resource_metadata="${resourceMetadataUrl(request)}"`
}

/** RFC 9728: the MCP endpoint and the server that issues tokens for it. */
export function protectedResourceMetadata(request: Request) {
  return {
    resource: mcpResource(request),
    authorization_servers: [issuer(request)],
    scopes_supported: [...SIGN_IN_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Flare',
  }
}

/**
 * RFC 8414: where each step of sign-in is. Clients are public and register
 * themselves, PKCE with S256 is required, and no client ID metadata documents
 * are advertised, so Flare never fetches anything a client names.
 */
export function authorizationServerMetadata(request: Request) {
  const base = issuer(request)
  return {
    issuer: base,
    authorization_endpoint: `${base}${AUTHORIZE_PATH}`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SIGN_IN_SCOPES],
    authorization_response_iss_parameter_supported: true,
  }
}
