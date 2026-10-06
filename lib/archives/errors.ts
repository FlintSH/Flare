export class ArchiveError extends Error {
  constructor(
    message: string,
    public status = 400,
    public readonly accessDenied = false
  ) {
    super(message)
    this.name = 'ArchiveError'
  }
}
