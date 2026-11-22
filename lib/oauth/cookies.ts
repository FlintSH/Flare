import {
  MAX_AUTHORIZE_QUERY,
  PENDING_COOKIE,
  PENDING_SECONDS,
  REQUEST_COOKIE,
} from './constants'

/**
 * The parameters of an authorize request that Flare reads. Only these are
 * kept while the person signs in; anything else a client sent is dropped.
 */
export const AUTHORIZE_PARAMETERS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const

/**
 * The query to keep, written so that it is safe as a cookie value and as the
 * query of a URL: form encoding leaves only letters, digits and `*-._+%=&`.
 */
export function storedQuery(query: URLSearchParams): string {
  const kept = new URLSearchParams()
  for (const name of AUTHORIZE_PARAMETERS)
    for (const value of query.getAll(name)) kept.append(name, value)
  return kept.toString()
}

/** Whether a stored query fits in one cookie, which browsers cap at 4096 bytes with its name. */
export function fitsCookie(stored: string): boolean {
  return `${REQUEST_COOKIE}=${stored}`.length <= MAX_AUTHORIZE_QUERY
}

const attributes = (secure: boolean, maxAge: number) =>
  `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`

/**
 * The two cookies that carry a sign-in across the login page: the request
 * itself, which scripts cannot read, and a marker that says only that one is
 * waiting. Neither needs integrity: what comes back is validated from scratch
 * as if the client had just sent it.
 */
export function pendingCookies(stored: string, secure: boolean): string[] {
  return [
    `${REQUEST_COOKIE}=${stored}; ${attributes(secure, PENDING_SECONDS)}; HttpOnly`,
    `${PENDING_COOKIE}=1; ${attributes(secure, PENDING_SECONDS)}`,
  ]
}

/** Both cookies, removed. */
export function clearedCookies(secure: boolean): string[] {
  return [
    `${REQUEST_COOKIE}=; ${attributes(secure, 0)}; HttpOnly`,
    `${PENDING_COOKIE}=; ${attributes(secure, 0)}`,
  ]
}

/** One cookie's value as the browser sent it, or null. */
function cookieValue(request: Request, name: string): string | null {
  for (const pair of (request.headers.get('cookie') ?? '').split(';')) {
    const at = pair.indexOf('=')
    if (at > 0 && pair.slice(0, at).trim() === name)
      return pair.slice(at + 1).trim()
  }
  return null
}

export function hasPendingCookies(request: Request): boolean {
  return (
    cookieValue(request, REQUEST_COOKIE) !== null ||
    cookieValue(request, PENDING_COOKIE) !== null
  )
}

/**
 * The query a waiting sign-in stored, rebuilt from the parameters Flare
 * reads, or null when there is none. The cookie is the browser's to change,
 * so its value is only ever read as form fields: whatever it holds, the
 * result is a query string and nothing else.
 */
export function pendingQuery(request: Request): string | null {
  const value = cookieValue(request, REQUEST_COOKIE)
  if (!value || value.length > MAX_AUTHORIZE_QUERY) return null
  return storedQuery(new URLSearchParams(value)) || null
}
