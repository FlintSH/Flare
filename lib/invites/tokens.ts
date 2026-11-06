import { createHash } from 'node:crypto'

import { isLinkToken, newLinkToken } from '@/lib/security/link-token'
import { decryptSecret, encryptSecret } from '@/lib/security/secret-box'

export const INVITE_TOKEN_PURPOSE = 'invites.link.v1'

// Invite tokens contain 256 random bits, so SHA-256 is a lookup digest for a
// high-entropy secret rather than a password hash.
export function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function isInviteToken(value: unknown): value is string {
  return isLinkToken(value)
}

/** Encryption uses the same key hierarchy as webhook signing secrets. */
export function createInviteToken() {
  const token = newLinkToken()
  return {
    token,
    hash: hashInviteToken(token),
    encrypted: encryptSecret(token, INVITE_TOKEN_PURPOSE),
  }
}

/** A changed encryption key only prevents copying the link again. */
export function readInviteToken(encrypted: string): string | null {
  try {
    const token = decryptSecret(encrypted, INVITE_TOKEN_PURPOSE)
    return isInviteToken(token) ? token : null
  } catch {
    return null
  }
}
