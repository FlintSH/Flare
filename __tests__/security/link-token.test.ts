import { describe, expect, it } from 'vitest'

import { isLinkToken, newLinkToken } from '@/lib/security/link-token'

describe('link tokens', () => {
  it('carry 256 random bits in 43 base64url characters', () => {
    const token = newLinkToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(newLinkToken()).not.toBe(token)
  })

  it('are recognized by their shape alone', () => {
    const token = newLinkToken()
    expect(isLinkToken(token)).toBe(true)
    for (const value of [`${token}=`, token.slice(1), `${'a'.repeat(42)}+`, 42])
      expect(isLinkToken(value)).toBe(false)
  })
})
