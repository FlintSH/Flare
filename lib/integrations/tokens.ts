import { createHash, randomBytes } from 'node:crypto'

import { requiredApiScope } from './bearer-routes'

export const TOKEN_PREFIX = 'flr_'

// Tokens contain 32 cryptographically random bytes (256 bits), so SHA-256 is a
// lookup digest for a high-entropy secret. This is not a password hashing helper.
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createRandomApiToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: hashApiToken(token) }
}

/** Unlike an API token, a signing secret is stored encrypted: Flare signs every delivery with it. */
export function createWebhookSecret(): string {
  return 'whsec_' + randomBytes(32).toString('base64url')
}

/** A named token works until it is revoked or reaches its expiry. */
export function tokenUsable(token: {
  revokedAt: Date | null
  expiresAt: Date | null
}): boolean {
  return !token.revokedAt && !(token.expiresAt && token.expiresAt <= new Date())
}

export function tokenAllowsRequest(
  scopes: readonly string[],
  request: Pick<Request, 'method' | 'url'>
): boolean {
  const required = requiredApiScope(
    request.method,
    new URL(request.url).pathname
  )
  return required !== null && scopes.includes(required)
}
