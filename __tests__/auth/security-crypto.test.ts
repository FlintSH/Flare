import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createTotp,
  decryptTotp,
  encryptTotp,
  newRecoveryCodes,
  recoveryHash,
  totpCounter,
  webauthnUserId,
} from '@/lib/auth/security/crypto'
import {
  relyingParty,
  validateSecurityOrigin,
} from '@/lib/auth/security/shared'

afterEach(() => vi.unstubAllEnvs())
describe('account security cryptography and origin', () => {
  it('encrypts with randomized authenticated ciphertext and rejects altered or changed-key ciphertext', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'a'.repeat(32))
    const secret = createTotp().secret.base32
    const encrypted = encryptTotp(secret)
    expect(encrypted).not.toContain(secret)
    expect(encryptTotp(secret)).not.toBe(encrypted)
    expect(decryptTotp(encrypted)).toBe(secret)
    expect(() => decryptTotp(encrypted.slice(0, -5) + 'aaaaa')).toThrow()
    vi.stubEnv('NEXTAUTH_SECRET', 'b'.repeat(32))
    expect(() => decryptTotp(encrypted)).toThrow()
  })
  it('accepts six-digit TOTP only within one step and returns its counter', () => {
    const totp = createTotp()
    const now = 1720000000000
    expect(
      totpCounter(totp.secret.base32, totp.generate({ timestamp: now }), now)
    ).toBe(Math.floor(now / 30000))
    expect(
      totpCounter(
        totp.secret.base32,
        totp.generate({ timestamp: now - 60000 }),
        now
      )
    ).toBeNull()
    expect(totpCounter(totp.secret.base32, '1e1234', now)).toBeNull()
  })
  it('creates ten independent 80-bit recovery codes with user-scoped hashes', () => {
    const codes = newRecoveryCodes()
    expect(new Set(codes).size).toBe(10)
    expect(
      codes.every((code) => /^[a-f0-9]{5}(?:-[a-f0-9]{5}){3}$/.test(code))
    ).toBe(true)
    expect(recoveryHash('one', codes[0])).toBe(
      recoveryHash('one', codes[0].toUpperCase().replaceAll('-', ' '))
    )
    expect(recoveryHash('one', codes[0])).not.toBe(
      recoveryHash('two', codes[0])
    )
    expect(webauthnUserId('one')).toHaveLength(32)
  })
  it('pins relying party and request origins to canonical configuration', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example/base')
    expect(relyingParty()).toEqual({
      rpID: 'flare.example',
      origin: 'https://flare.example',
      rpName: 'Flare',
    })
    expect(() =>
      validateSecurityOrigin(
        new Request('https://untrusted.example/api', {
          headers: { origin: 'https://untrusted.example' },
        })
      )
    ).toThrow('origin')
    expect(() =>
      validateSecurityOrigin(new Request('https://flare.example/api'))
    ).toThrow('origin')
    expect(() =>
      validateSecurityOrigin(
        new Request('https://flare.example/api', {
          headers: {
            origin: 'https://flare.example',
            authorization: 'Bearer token',
          },
        })
      )
    ).toThrow('browser session')
    expect(() =>
      validateSecurityOrigin(
        new Request('http://internal:3000/api', {
          headers: { origin: 'https://flare.example' },
        })
      )
    ).not.toThrow()
    vi.stubEnv('NEXTAUTH_URL', 'http://flare.example')
    expect(() => relyingParty()).toThrow('HTTPS')
  })
})
