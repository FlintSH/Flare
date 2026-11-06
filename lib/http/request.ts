import { isSameOriginRequest } from '@/lib/security/request-origin'

import { HttpError } from './errors'

/** The request's media type without parameters, lower-cased. */
export function mediaType(request: Request) {
  return (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ??
    ''
  )
}

function assertMediaType(request: Request, type: string) {
  if (mediaType(request) !== type) throw new HttpError(415, `Use ${type}.`)
}

/** GET, HEAD and OPTIONS read; every other method may change something. */
export function isWrite(request: Request) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
}

/** The request comes from Flare's own pages, whatever its method. */
export function assertSameOrigin(request: Request) {
  if (!isSameOriginRequest(request))
    throw new HttpError(403, 'Cross-origin requests are not allowed.')
}

const browserWrites = new WeakSet<Request>()

/**
 * A browser attaches the session cookie to requests other sites send, so a
 * write the cookie authenticates must come from Flare's own pages. Its body
 * readers then take only their own type, JSON or a multipart form, so the
 * plain-text and URL-encoded posts another site can send without a CORS
 * preflight are refused too.
 */
export function assertBrowserWrite(request: Request) {
  if (!isWrite(request)) return
  assertSameOrigin(request)
  browserWrites.add(request)
}

/** The body as bytes, refusing to buffer more than `limit` bytes. */
export async function readBody(
  request: Request,
  limit: number,
  signal?: AbortSignal
): Promise<Buffer> {
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, 'Request body is too large.')
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const abort = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => {})
        throw new HttpError(413, 'Request body is too large.')
      }
      chunks.push(value)
    }
    signal?.throwIfAborted()
    return Buffer.concat(chunks)
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/** JSON bodies are capped at 1 MiB unless a route sets a smaller limit. */
export const JSON_BODY_LIMIT = 1024 * 1024

export async function readJson(
  request: Request,
  {
    limit = JSON_BODY_LIMIT,
    signal,
  }: { limit?: number; signal?: AbortSignal } = {}
): Promise<unknown> {
  if (browserWrites.has(request)) assertMediaType(request, 'application/json')
  const text = (await readBody(request, limit, signal)).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Invalid JSON.')
  }
}

/** Room for the boundaries and part headers around one file in a multipart body. */
export const FORM_FRAMING_BYTES = 64 * 1024

/**
 * The form in the body, refusing to buffer more than `limit` bytes; a larger
 * body answers 413 with `tooLarge`. Like `request.formData()`, it rejects with
 * a TypeError when the body isn't the form its content type names.
 */
export async function readForm(
  request: Request,
  {
    limit,
    tooLarge = 'Request body is too large.',
  }: { limit: number; tooLarge?: string }
): Promise<FormData> {
  if (browserWrites.has(request))
    assertMediaType(request, 'multipart/form-data')
  const body = await readBody(request, limit).catch((error: unknown) => {
    throw error instanceof HttpError && error.status === 413
      ? new HttpError(413, tooLarge)
      : error
  })
  return new Response(new Uint8Array(body), {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  }).formData()
}
