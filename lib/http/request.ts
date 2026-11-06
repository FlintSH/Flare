import { isSameOriginRequest } from '@/lib/security/request-origin'

import { HttpError } from './errors'

/** The request's media type without parameters, lower-cased. */
export function mediaType(request: Request) {
  return (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ??
    ''
  )
}

/** Browser-session writes must come from this app's own pages. */
export function assertSameOrigin(request: Request) {
  if (!isSameOriginRequest(request))
    throw new HttpError(403, 'Cross-origin requests are not allowed.')
}

export function assertMediaType(request: Request, type: string) {
  if (mediaType(request) !== type) throw new HttpError(415, `Use ${type}.`)
}

/** A same-origin write whose body, if it has one, is JSON. */
export function assertJsonMutation(request: Request, { body = true } = {}) {
  assertSameOrigin(request)
  if (body) assertMediaType(request, 'application/json')
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
  { limit = JSON_BODY_LIMIT }: { limit?: number } = {}
): Promise<unknown> {
  const text = (await readBody(request, limit)).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Invalid JSON.')
  }
}
