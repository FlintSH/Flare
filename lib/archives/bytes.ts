/**
 * Byte reads for the archive parsers, which run on the server over storage
 * and in the browser over a decrypted file (docs/e2ee-spec.md, section
 * 12.3). Only `Uint8Array`: a Node.js `Buffer` is one, a browser has no
 * `Buffer`. A caller checks the length before it reads.
 */
export function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

export function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

/** A 64-bit value, or null when a JavaScript number cannot hold it exactly. */
export function u64(bytes: Uint8Array, offset: number): number | null {
  const high = u32(bytes, offset + 4)
  if (high > 0x1fffff) return null
  return high * 0x100000000 + u32(bytes, offset)
}

export function latin1(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length
): string {
  let text = ''
  for (let index = start; index < end; index += 0x8000)
    text += String.fromCharCode(
      ...bytes.subarray(index, Math.min(end, index + 0x8000))
    )
  return text
}

// Like `Buffer.toString('utf8')`: bad sequences become U+FFFD and a byte
// order mark stays.
const lenientUtf8 = new TextDecoder('utf-8', { ignoreBOM: true })

export function utf8(bytes: Uint8Array, start = 0, end = bytes.length): string {
  return lenientUtf8.decode(bytes.subarray(start, end))
}

export function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0))
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++)
    if (left[index] !== right[index]) return false
  return true
}

export function joinBytes(parts: readonly Uint8Array[], length: number) {
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Lets other work run. `setImmediate` where there is one, a timer elsewhere. */
export function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve)
    else setTimeout(resolve, 0)
  })
}
