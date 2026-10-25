export class ArchiveError extends Error {
  /** For 429s with a known wait, such as paused file-password checks. */
  retryAfterSeconds?: number

  constructor(
    message: string,
    public status = 400,
    public readonly accessDenied = false
  ) {
    super(message)
    this.name = 'ArchiveError'
  }
}
