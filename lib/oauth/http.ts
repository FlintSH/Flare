import { HttpError } from '@/lib/http/errors'
import { readBody } from '@/lib/http/request'
import type { RouteContract } from '@/lib/http/route'
import { mcpEnabled, mcpNotFound } from '@/lib/mcp/settings'

/**
 * A refusal as OAuth words it: a code clients act on and a sentence for the
 * person debugging. Never put a token, code or verifier in the description.
 */
export class OAuthError extends HttpError {
  constructor(
    readonly code: string,
    description: string,
    status = 400,
    headers?: Record<string, string>
  ) {
    super(status, description, {
      headers,
      body: { error: code, error_description: description },
    })
    this.name = 'OAuthError'
  }
}

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

/**
 * The endpoints clients call directly: metadata, registration, token and
 * revocation. They read no cookie, so any site may call them, and every
 * answer is uncached. Errors are OAuth errors, whatever was thrown.
 */
export const clientRoutes: RouteContract = {
  failure: { message: 'server_error' },
  headers: { ...NO_STORE, 'Access-Control-Allow-Origin': '*' },
  translate: (error) =>
    error instanceof HttpError && !(error instanceof OAuthError)
      ? new OAuthError(
          error.status >= 500 ? 'server_error' : 'invalid_request',
          error.message,
          error.status
        )
      : undefined,
}

/**
 * The endpoints the person's browser visits. They act on the session cookie,
 * so they send no CORS headers and stay same-site.
 */
export const browserRoutes: RouteContract = {
  failure: { message: 'Flare could not continue this sign-in. Try again.' },
  headers: { ...NO_STORE, 'Referrer-Policy': 'no-referrer' },
}

/**
 * A redirect, with any cookies to set on the way. A path starting with `/`
 * stays on whatever address the browser used to reach Flare, so it works
 * behind a reverse proxy without asking what that address is.
 */
export function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/** While the MCP server is off nothing is here and nothing is recorded. */
export function whileOn<Arguments extends unknown[]>(
  handler: (...parameters: Arguments) => Promise<Response>
) {
  return async (...parameters: Arguments): Promise<Response> =>
    (await mcpEnabled()) ? handler(...parameters) : mcpNotFound()
}

/**
 * The preflight of an endpoint any site may call. `headers` are the request
 * headers a browser may send beyond the ones it always may.
 */
export function openPreflight(methods: string, headers: string) {
  return whileOn(
    async () =>
      new Response(null, {
        status: 204,
        headers: {
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': methods,
          'Access-Control-Allow-Headers': headers,
          'Access-Control-Max-Age': '600',
        },
      })
  )
}

/** What a browser client sends with a form or JSON post. */
export const POST_HEADERS = 'Content-Type, Authorization'

/** Token and revocation requests are a handful of short fields. */
export const FORM_BODY_BYTES = 16 * 1024

/**
 * The fields of a form-encoded request. OAuth forbids repeating a parameter,
 * and reading the first of two would let a request mean different things to
 * different readers, so a repeated one is refused.
 */
export async function readOAuthForm(request: Request) {
  const type = request.headers.get('content-type')?.split(';')[0].trim()
  if (type?.toLowerCase() !== 'application/x-www-form-urlencoded')
    throw new OAuthError(
      'invalid_request',
      'Send the parameters as application/x-www-form-urlencoded.'
    )
  const body = await readBody(request, FORM_BODY_BYTES)
  const fields = new URLSearchParams(body.toString('utf8'))
  const seen = new Set<string>()
  for (const name of fields.keys()) {
    if (seen.has(name))
      throw new OAuthError(
        'invalid_request',
        'A parameter is sent more than once.'
      )
    seen.add(name)
  }
  return fields
}
