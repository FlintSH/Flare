import type { ZodError } from 'zod'

/**
 * A failure whose status and message are meant for the client. Domain errors
 * extend it, so a route can answer any of them without knowing every domain.
 */
export class HttpError extends Error {
  readonly headers: Record<string, string>
  /** Extra fields for the error body, such as a machine-readable code. */
  readonly body: Record<string, unknown>

  constructor(
    readonly status: number,
    message: string,
    options: {
      headers?: Record<string, string>
      body?: Record<string, unknown>
      /** What failed underneath, for the server log; never sent. */
      cause?: unknown
    } = {}
  ) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined)
    this.name = 'HttpError'
    this.headers = options.headers ?? {}
    this.body = options.body ?? {}
  }
}

/**
 * Sign-in and permission refusals. They answer `{ error }` on every route,
 * whatever envelope the route's other errors use.
 */
export class AccessError extends HttpError {
  constructor(status: 401 | 403, message: string) {
    super(status, message)
    this.name = 'AccessError'
  }
}

/**
 * Request input that isn't what the route reads: a 400 that each route family
 * words with its contract's `invalid`, from the first issue by default.
 */
export class InvalidInput extends HttpError {
  constructor(readonly issues: ZodError) {
    super(400, issues.issues[0]?.message ?? 'Invalid request.')
    this.name = 'InvalidInput'
  }
}

/**
 * A rejection handler for a call whose failure means a service Flare needs
 * is down: it answers 503 with `message` and logs what failed.
 */
export function unavailable(message: string) {
  return (cause: unknown): never => {
    throw new HttpError(503, message, { cause })
  }
}
