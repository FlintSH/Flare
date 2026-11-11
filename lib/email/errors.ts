import { HttpError } from '@/lib/http/errors'

/** An email request failure whose message is written for the person who made it. */
export class EmailHttpError extends HttpError {
  constructor(
    message: string,
    status = 400,
    options: { body?: Record<string, unknown> } = {}
  ) {
    super(status, message, options)
    this.name = 'EmailHttpError'
  }
}
