import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * After a visitor submits a file password, previews load through ordinary GET
 * requests (images, video seeking) without putting the password in a URL. A
 * short-lived HttpOnly cookie, scoped to that file's shared archive routes,
 * proves the password was checked. It is bound to the current password hash,
 * so changing or removing the password invalidates it.
 */
export const ARCHIVE_UNLOCK_COOKIE = 'flare_archive_unlock'
export const ARCHIVE_UNLOCK_SECONDS = 60 * 60

const keyState = Symbol.for('flare.archive.unlock-key')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}

function unlockKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (secret && secret.length >= 32)
    return Buffer.from(
      hkdfSync('sha256', secret, 'flare-archive-unlock-v1', 'cookie', 32)
    )
  // Without a stable secret, unlocks still work within this process.
  return (processState[keyState] ??= randomBytes(32)) as Buffer
}

/**
 * `passwordHash` is the file's stored bcrypt hash, used only as a version so a
 * password change revokes outstanding cookies. No plaintext password reaches
 * this MAC, the cookie never contains the hash, and the result is never stored
 * or used to verify a password, so a fast keyed MAC is appropriate here.
 */
function signature(fileId: string, passwordHash: string, expires: number) {
  return createHmac('sha256', unlockKey())
    .update(`${fileId}\n${passwordHash}\n${expires}`)
    .digest('base64url')
}

export function archiveUnlockPath(fileId: string) {
  return `/api/files/${encodeURIComponent(fileId)}/archive/share`
}

export function createArchiveUnlock(
  fileId: string,
  passwordHash: string,
  secure: boolean,
  now = Date.now()
) {
  const expires = Math.floor(now / 1000) + ARCHIVE_UNLOCK_SECONDS
  const value = `v1.${expires}.${signature(fileId, passwordHash, expires)}`
  return [
    `${ARCHIVE_UNLOCK_COOKIE}=${value}`,
    `Path=${archiveUnlockPath(fileId)}`,
    `Max-Age=${ARCHIVE_UNLOCK_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

export function readArchiveUnlock(request: Request) {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === ARCHIVE_UNLOCK_COOKIE) return value.join('=')
  }
  return null
}

export function verifyArchiveUnlock(
  value: string | null,
  fileId: string,
  passwordHash: string | null,
  now = Date.now()
) {
  if (!value || !passwordHash) return false
  const [version, expiresText, mac, extra] = value.split('.')
  const expires = Number(expiresText)
  if (
    version !== 'v1' ||
    extra !== undefined ||
    !mac ||
    !Number.isSafeInteger(expires) ||
    expires * 1000 <= now
  )
    return false
  const expected = Buffer.from(signature(fileId, passwordHash, expires))
  const received = Buffer.from(mac)
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}

/** Match next-auth: secure cookies when the public URL uses HTTPS. */
export function secureCookies(request: Request) {
  const configured = process.env.NEXTAUTH_URL
  if (configured) return configured.startsWith('https://')
  return new URL(request.url).protocol === 'https:'
}
