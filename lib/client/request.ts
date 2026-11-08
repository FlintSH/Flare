const UNEXPLAINED = 'Unable to complete this request. Please try again.'

/** No answer was confirmed; a mutation may already have reached the server. */
export class TransportFailure extends Error {
  constructor(cause: unknown) {
    super('Connection problem. Check the result before trying again.', {
      cause,
    })
    this.name = 'TransportFailure'
  }
}

/**
 * The server refused a request, or answered with something other than JSON.
 * The message is its reason, or the caller's fallback when it gave none.
 */
export class RefusedRequest extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The machine-readable reason some refusals add, such as `invite_used`. */
    readonly code: string | null = null,
    /** How many seconds the server asked the client to wait, from `Retry-After`. */
    readonly retryAfter: number | null = null,
    cause?: unknown
  ) {
    super(message, { cause })
    this.name = 'RefusedRequest'
  }
}

function isAbort(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

function transportFailure(error: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return isAbort(error) ||
    error instanceof TransportFailure ||
    error instanceof RefusedRequest
    ? error
    : new TransportFailure(error)
}

/**
 * Normalize only an actual fetch/body-read promise. Evaluate request inputs
 * first; JSON/schema parsing and application work belong outside this boundary.
 */
export async function readTransport<T>(
  pending: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let value: T
  try {
    value = await pending
  } catch (cause) {
    throw transportFailure(cause, signal)
  }
  signal?.throwIfAborted()
  return value
}

function text(body: unknown, field: string) {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[field]
  return typeof value === 'string' && value ? value : null
}

function retryAfter(response: Response) {
  const header = response.headers.get('Retry-After')?.trim()
  const seconds = header ? Number(header) : NaN
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

export async function refusal(
  response: Response,
  fallback = UNEXPLAINED,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  let raw: string
  try {
    raw = await response.text()
  } catch (cause) {
    signal?.throwIfAborted()
    if (isAbort(cause)) throw cause
    // An HTTP refusal is already known even when its body is interrupted.
    return new RefusedRequest(
      fallback,
      response.status,
      null,
      retryAfter(response),
      cause
    )
  }
  signal?.throwIfAborted()
  let body: unknown = null
  try {
    body = JSON.parse(raw)
  } catch {
    // Keep the actual HTTP status and the caller's human fallback.
  }
  return new RefusedRequest(
    text(body, 'error') ?? fallback,
    response.status,
    text(body, 'code'),
    retryAfter(response)
  )
}

/**
 * Whether asking again can help: no answer arrived, or the server timed out,
 * was busy or failed. Any other refusal answers the same way every time.
 */
export function retryable(error: unknown) {
  return (
    !(error instanceof RefusedRequest) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  )
}

interface AnswerOptions {
  signal?: AbortSignal
  /** The message for a refusal that gives no reason. */
  fallback?: string
  /** Read the whole answer, such as a page with its `pagination`, not only its `data`. */
  whole?: boolean
}

/**
 * The answer to a request to Flare's API: its `data`, or the whole answer when
 * `data` is missing or null, as from endpoints without that envelope, and
 * `{}` for an empty one. An error status
 * or an answer that isn't JSON rejects with a `RefusedRequest`. Once `signal`
 * aborts it rejects even if the answer has arrived, so an abandoned action
 * never goes on.
 */
export async function readAnswer<T>(
  response: Response,
  { signal, fallback = UNEXPLAINED, whole = false }: AnswerOptions = {}
): Promise<T> {
  signal?.throwIfAborted()
  if (!response.ok) throw await refusal(response, fallback, signal)
  let body: string
  try {
    body = await response.text()
  } catch (cause) {
    throw transportFailure(cause, signal)
  }
  signal?.throwIfAborted()
  if (!body) return {} as T
  let answer
  try {
    answer = JSON.parse(body)
  } catch {
    throw new RefusedRequest(fallback, response.status)
  }
  return (whole ? answer : (answer?.data ?? answer)) as T
}

export interface RequestOptions extends AnswerOptions {
  /** Defaults to POST with a body and GET without one. */
  method?: string
  /** Sent as JSON, or as it is when it is form data. */
  body?: unknown
}

/** Sends a request to Flare's API, uncached, and returns its raw answer. */
export async function sendRequest(
  path: string,
  { method, body, signal }: RequestOptions = {}
) {
  signal?.throwIfAborted()
  const form = body instanceof FormData
  // Serialize outside the transport catch: caller/programming errors are not
  // connection failures and must keep their original identity.
  const request: RequestInit = {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    signal,
    cache: 'no-store',
    headers:
      body === undefined || form
        ? undefined
        : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  }
  let response: Response
  try {
    response = await fetch(path, request)
  } catch (cause) {
    throw transportFailure(cause, signal)
  }
  signal?.throwIfAborted()
  return response
}

/**
 * A request to Flare's API, answered as `readAnswer` reads it. A network
 * or body-read failure has a human message and retains its original cause.
 * Cancellation keeps its original identity. This helper never retries.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  return readAnswer<T>(await sendRequest(path, options), options)
}
