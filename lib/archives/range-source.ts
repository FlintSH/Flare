/**
 * What the archive parsers read from: bytes at a position. The server gives
 * a stored object, the browser a decrypted file. No Node.js imports.
 */
export interface RangeSource {
  readonly size: number
  /** Exactly `length` bytes from `start`. A short read is damage. */
  read(start: number, length: number): Promise<Uint8Array>
}
