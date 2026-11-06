/**
 * Whether a storage error means the object itself is gone: a local file that
 * doesn't exist (`ENOENT`) or an S3 key that doesn't (`NoSuchKey`, or
 * `NotFound` when S3 answers a HEAD request, whose empty body can't tell a
 * missing key from a missing bucket). A missing bucket reported in a body, and
 * every other HTTP 404, count as storage failures instead.
 */
export function isMissingObject(error: unknown): boolean {
  const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown }
  return ['ENOENT', 'NoSuchKey', 'NotFound'].includes(String(code || name))
}
