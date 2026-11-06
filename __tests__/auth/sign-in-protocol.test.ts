import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isPasskeyRecoveryCode,
  isRecoveryCodeInput,
  newPasskeyRecoveryCodes,
  newRecoveryCodes,
  normalizeRecoveryCode,
} from '@/lib/auth/security/crypto'
import {
  passkeyChallengeCookie,
  readPasskeyChallengeCookie,
} from '@/lib/auth/security/passkeys'
import {
  TOTP_CODE_PATTERN,
  TOTP_PLACEHOLDER,
  isTotpCode,
} from '@/lib/auth/security/policy'
import {
  LOCAL_SIGN_IN_PATH,
  TOO_MANY_SIGN_IN_ATTEMPTS,
  getOidcErrorMessage,
  isLocalSignIn,
  oidcErrorPath,
} from '@/lib/auth/sign-in'

afterEach(() => vi.unstubAllEnvs())

describe('the login page protocol', () => {
  it('builds the same login addresses as before', () => {
    expect(LOCAL_SIGN_IN_PATH).toBe('/auth/login?local=1')
    expect(oidcErrorPath('OidcNoEmail')).toBe('/auth/login?error=OidcNoEmail')
    expect(oidcErrorPath('OidcPasskeyRequired', true)).toBe(
      '/auth/login?local=1&error=OidcPasskeyRequired'
    )
    expect(isLocalSignIn({ local: '1' })).toBe(true)
    for (const local of [undefined, '', 'true', ['1', '1']])
      expect(isLocalSignIn({ local })).toBe(false)
  })

  it('explains both refusals that keep the local form open', () => {
    const fallback = getOidcErrorMessage('SomeUnrecognizedCode')
    for (const code of ['OidcPasskeyRequired', 'OidcTwoFactorRequired'])
      expect(getOidcErrorMessage(code)).not.toBe(fallback)
  })

  it('names the attempt-limit window in the throttled sign-in message', () => {
    expect(TOO_MANY_SIGN_IN_ATTEMPTS).toBe(
      'Too many sign-in attempts. Wait 15 minutes before trying again.'
    )
  })
})

describe('code formats', () => {
  it('accepts six-digit authenticator codes, as the form fields ask', () => {
    expect(TOTP_CODE_PATTERN).toBe('[0-9]{6}')
    expect(TOTP_PLACEHOLDER).toBe('000000')
    expect(isTotpCode('123456')).toBe(true)
    for (const code of ['12345', '1234567', '1e1234', '12345a'])
      expect(isTotpCode(code)).toBe(false)
  })

  it('recognizes each kind of recovery code as it is generated and typed', () => {
    const [code] = newRecoveryCodes()
    expect(isRecoveryCodeInput(code)).toBe(true)
    expect(isRecoveryCodeInput(code.toUpperCase().replaceAll('-', ' '))).toBe(
      true
    )
    expect(isRecoveryCodeInput('123456')).toBe(false)
    const [passkeyCode] = newPasskeyRecoveryCodes()
    expect(passkeyCode).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/)
    expect(
      isPasskeyRecoveryCode(normalizeRecoveryCode(passkeyCode.toUpperCase()))
    ).toBe(true)
    expect(isPasskeyRecoveryCode(normalizeRecoveryCode(code))).toBe(false)
  })
})

describe('the passkey challenge cookie', () => {
  it('is host-only and secure over HTTPS, and lasts as long as the challenge', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
    expect(passkeyChallengeCookie('binding')).toEqual({
      name: '__Host-flare-passkey-challenge',
      value: 'binding',
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
      maxAge: 300,
    })
    expect(
      readPasskeyChallengeCookie(
        'theme=dark; __Host-flare-passkey-challenge=abc_123; other=1'
      )
    ).toBe('abc_123')
    expect(readPasskeyChallengeCookie('flare-passkey-challenge=abc')).toBe('')
    expect(readPasskeyChallengeCookie(undefined)).toBe('')
  })

  it('drops the host prefix on local HTTP development', () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    expect(passkeyChallengeCookie('binding')).toMatchObject({
      name: 'flare-passkey-challenge',
      secure: false,
    })
    expect(readPasskeyChallengeCookie('flare-passkey-challenge=abc')).toBe(
      'abc'
    )
  })
})
