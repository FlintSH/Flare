/**
 * The public identifier of an encrypted file (docs/e2ee-spec.md, section
 * 10.3). It replaces the file name in the address `/{urlId}/{fileId}`: the
 * name of an encrypted file is secret. The server makes it from 16 random
 * bytes. It carries no information about the file.
 *
 * The form is `e_` and 22 base64url characters. A plain file's URL name is
 * lower case letters, digits and hyphens with an optional extension, so it
 * never has this form, and the proxy can tell the two apart without the
 * database. Browser-safe: no Node.js imports.
 */
export const ENCRYPTED_FILE_ID_PATTERN = /^e_[A-Za-z0-9_-]{22}$/

export function isEncryptedFileId(segment: string): boolean {
  return ENCRYPTED_FILE_ID_PATTERN.test(segment)
}

/** Whether a path is `/{urlId}/{fileId}`, optionally with `/raw` or `/direct`. */
export function isEncryptedFilePath(pathname: string): boolean {
  const segments = pathname.split('/')
  return (
    segments.length >= 3 &&
    segments.length <= 4 &&
    segments[0] === '' &&
    isEncryptedFileId(segments[2])
  )
}

/** `randomBytes` gives 16 bytes from a cryptographically secure generator. */
export function encryptedFileId(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 16) throw new Error('A file ID needs 16 bytes')
  let binary = ''
  for (const byte of randomBytes) binary += String.fromCharCode(byte)
  return `e_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}
