/**
 * CRC-32 as ZIP and gzip use it (polynomial 0xEDB88320), for code that also
 * runs in a browser, where `node:zlib` does not exist. Pass the last result
 * to continue over the next piece.
 */
const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0
  for (let index = 0; index < bytes.length; index++)
    crc = TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return ~crc >>> 0
}
