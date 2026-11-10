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

export function truncatedArchive() {
  return new ArchiveError(
    'The archive ends unexpectedly. It may be incomplete or damaged.'
  )
}

export function damagedEntry() {
  return new ArchiveError(
    'This file’s data in the archive is damaged, so it can’t be read.'
  )
}
