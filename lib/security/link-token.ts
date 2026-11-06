import { randomBytes } from 'node:crypto'

/**
 * A secret that a link carries, such as an invite link or an emailed account
 * link: 256 random bits in base64url, 43 characters.
 */
export function newLinkToken() {
  return randomBytes(32).toString('base64url')
}

/** Whether a value is written like a link token, before anything looks it up. */
export function isLinkToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}
