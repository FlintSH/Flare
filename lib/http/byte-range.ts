/** A satisfiable single byte range with an inclusive end, as storage reads take it. */
export type ByteRange = { start: number; end: number }

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/i

/**
 * Interpret a `Range` header for a resource of `size` bytes (RFC 9110 §14).
 *
 * - `null`: serve the whole resource. The header is absent, malformed, a
 *   reversed range, or asks for several ranges, all of which a server may ignore.
 * - `'unsatisfiable'`: answer `416` with `Content-Range: bytes *\/<size>`. No byte
 *   of the resource is in the range, which includes any range of an empty file.
 * - Otherwise the bytes to send, with the end clamped to the last byte.
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number
): ByteRange | 'unsatisfiable' | null {
  const match = header?.trim().match(SINGLE_RANGE)
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    // Suffix range: the final N bytes. Oversized values select the whole file.
    const suffix = Number(match[2])
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const last = match[2] ? Number(match[2]) : Infinity
  if (last < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: Math.min(last, size - 1) }
}
