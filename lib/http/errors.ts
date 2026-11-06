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
    } = {}
  ) {
    super(message)
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
