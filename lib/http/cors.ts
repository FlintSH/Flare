import { requiredApiScope } from '@/lib/integrations/bearer-routes'

/**
 * Cross-origin access for web apps on other sites, which FLARE_CORS_ORIGINS
 * turns on. Two kinds of route take part:
 *
 * - `token`: the API routes a named token may call. A page elsewhere can call
 *   them with a token it holds in an Authorization header.
 * - `file`: `/raw` and `/direct` file content, read as an anonymous visitor.
 *
 * Responses never carry Access-Control-Allow-Credentials, so browsers don't
 * send Flare's session cookie with these requests or let another site read
 * an answer the cookie authorized. Only a credential the page itself sends
 * works, and anything a session alone could do stays on Flare's own pages.
 */
export type CorsKind = 'token' | 'file'

export const CORS_ENV = 'FLARE_CORS_ORIGINS'

type CorsPolicy = { any: true } | { any: false; origins: ReadonlySet<string> }

/** The headers a token client may send: its credential, a JSON or form body, and upload options. */
const ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Upload-Profile',
  'X-Upload-Folder',
  'X-Flare-Paste',
].join(', ')

/** Response headers clients need beyond the CORS-safelisted ones. */
const EXPOSED_HEADERS = {
  token: ['Retry-After'],
  file: ['Accept-Ranges', 'Content-Disposition', 'Content-Range'],
} satisfies Record<CorsKind, string[]>

/** How long a browser may reuse a preflight answer, in seconds. */
const PREFLIGHT_MAX_AGE = '600'

const TOKEN_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const FILE_METHODS = ['GET', 'HEAD'] as const

/** One origin as a browser sends it, or null when the entry isn't one. */
function parseOrigin(entry: string): string | null {
  let url: URL
  try {
    url = new URL(entry)
  } catch {
    return null
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    return null
  return url.origin
}

/**
 * The configured policy, with the entries that are not origins. Entries are
 * separated by commas or whitespace. `*` allows every origin; otherwise each
 * entry is an origin such as `https://app.example.com` or
 * `http://localhost:5173`, without a path. Unset or empty disables CORS.
 */
export function readCorsPolicy(value: string | undefined): {
  policy: CorsPolicy | null
  invalid: string[]
} {
  const entries = (value ?? '').split(/[\s,]+/).filter(Boolean)
  const invalid: string[] = []
  const origins = new Set<string>()
  let any = false
  for (const entry of entries) {
    if (entry === '*') {
      any = true
      continue
    }
    const origin = parseOrigin(entry)
    if (origin) origins.add(origin)
    else invalid.push(entry)
  }
  if (any) return { policy: { any: true }, invalid }
  return { policy: origins.size ? { any: false, origins } : null, invalid }
}

let cached: { value: string | undefined; policy: CorsPolicy | null } | null =
  null

/** The policy in the environment now, parsed again only when it changes. */
function currentPolicy(): CorsPolicy | null {
  const value = process.env[CORS_ENV]
  if (!cached || cached.value !== value)
    cached = { value, policy: readCorsPolicy(value).policy }
  return cached.policy
}

/** Startup warnings for entries Flare ignores. */
export function corsWarnings(value: string | undefined): string[] {
  return readCorsPolicy(value).invalid.map(
    (entry) =>
      `${CORS_ENV} ignores "${entry}": use *, or origins such as https://app.example.com without a path.`
  )
}

function eligibleMethod(
  kind: CorsKind,
  method: string,
  pathname: string
): boolean {
  if (kind === 'file')
    return (FILE_METHODS as readonly string[]).includes(method)
  return requiredApiScope(method, pathname) !== null
}

/**
 * Whether other sites may use `method` on this route, and if so the
 * Access-Control-Allow-Origin value for this request: null when CORS is off
 * or the request's origin isn't allowed. A preflight names the method the
 * browser will use in a header.
 */
function crossOrigin(
  request: Request,
  kind: CorsKind,
  method: string
): { policy: CorsPolicy; origin: string | null } | null {
  const policy = currentPolicy()
  if (!policy || !eligibleMethod(kind, method, new URL(request.url).pathname))
    return null
  const origin = request.headers.get('origin')
  if (!origin) return { policy, origin: null }
  return {
    policy,
    origin: policy.any ? '*' : policy.origins.has(origin) ? origin : null,
  }
}

/** Caches must keep answers for different origins apart when the answer depends on it. */
function varyOnOrigin(headers: Headers, policy: CorsPolicy) {
  if (policy.any) return
  const vary = headers.get('vary')
  if (!vary) headers.set('Vary', 'Origin')
  else if (
    !vary
      .split(',')
      .some((name) => ['origin', '*'].includes(name.trim().toLowerCase()))
  )
    headers.set('Vary', `${vary}, Origin`)
}

/** Adds CORS headers to the answer of an actual (not preflight) request. */
export function applyCors(
  request: Request,
  response: Response,
  kind: CorsKind
): Response {
  if (request.method === 'OPTIONS') return response
  const access = crossOrigin(request, kind, request.method)
  if (!access) return response
  try {
    varyOnOrigin(response.headers, access.policy)
    if (!access.origin) return response
    response.headers.set('Access-Control-Allow-Origin', access.origin)
    response.headers.set(
      'Access-Control-Expose-Headers',
      EXPOSED_HEADERS[kind].join(', ')
    )
  } catch {
    // A response with immutable headers is answered as it is.
  }
  return response
}

/** The methods this path accepts from other sites. */
function allowedMethods(kind: CorsKind, pathname: string): string[] {
  if (kind === 'file') return [...FILE_METHODS]
  return TOKEN_METHODS.filter(
    (method) => requiredApiScope(method, pathname) !== null
  )
}

/**
 * The OPTIONS handler for a route of this kind. A preflight from an allowed
 * origin for an allowed method gets the CORS answer; anything else gets a
 * plain 204 without one, which the browser treats as a refusal.
 */
export function preflight(kind: CorsKind) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control': 'no-store' })
    const requested = request.headers
      .get('access-control-request-method')
      ?.toUpperCase()
    const access = requested ? crossOrigin(request, kind, requested) : null
    if (access) varyOnOrigin(headers, access.policy)
    if (access?.origin) {
      headers.set('Access-Control-Allow-Origin', access.origin)
      headers.set(
        'Access-Control-Allow-Methods',
        allowedMethods(kind, new URL(request.url).pathname).join(', ')
      )
      headers.set(
        'Access-Control-Allow-Headers',
        kind === 'token' ? ALLOWED_HEADERS : 'Range'
      )
      headers.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE)
    }
    return new Response(null, { status: 204, headers })
  }
}
