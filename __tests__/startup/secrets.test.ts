import { describe, expect, it } from 'vitest'

import { sessionSecretWarnings } from '@/lib/startup/secrets'

describe('session secret startup warnings', () => {
  it('flags the example value shipped by the earlier Compose file', () => {
    const [warning, ...rest] = sessionSecretWarnings('your-secret-key-here')
    expect(rest).toEqual([])
    expect(warning).toContain('published example value')
    expect(warning).toContain('sign in again')
  })

  it('flags a secret too short for Flare encryption', () => {
    const [warning, ...rest] = sessionSecretWarnings('a'.repeat(31))
    expect(rest).toEqual([])
    expect(warning).toContain('shorter than 32 characters')
  })

  it('accepts a generated 32-character or longer secret', () => {
    expect(sessionSecretWarnings('a'.repeat(32))).toEqual([])
    expect(sessionSecretWarnings('0123456789abcdef'.repeat(4))).toEqual([])
  })

  it('leaves a missing secret to NextAuth', () => {
    expect(sessionSecretWarnings('')).toEqual([])
    expect(sessionSecretWarnings(undefined)).toEqual([])
  })
})
