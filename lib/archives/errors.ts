import { HttpError } from '@/lib/http/errors'

export class ArchiveError extends HttpError {
  /** For 429s with a known wait, such as paused file-password checks. */
  retryAfterSeconds?: number

  constructor(
    message: string,
    status = 400,
    readonly accessDenied = false
  ) {
    super(status, message)
    this.name = 'ArchiveError'
  }
}
