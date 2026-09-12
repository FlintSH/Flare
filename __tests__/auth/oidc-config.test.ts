import { describe, expect, it } from 'vitest'

import { isOidcProviderConfigured } from '@/lib/auth'
import { getOidcErrorMessage } from '@/lib/auth/oidc-error-messages'
import { DEFAULT_CONFIG, configSchema } from '@/lib/config'

const complete = {
  enabled: true,
  issuer: 'https://idp.example.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  buttonText: 'Sign in with SSO',
}

describe('isOidcProviderConfigured', () => {
  it('is true when enabled with issuer, clientId, and clientSecret all set', () => {
    expect(isOidcProviderConfigured(complete)).toBe(true)
  })

  it.each([
    ['enabled', false],
    ['issuer', ''],
    ['clientId', ''],
    ['clientSecret', ''],
  ] as const)('is false when %s is missing', (field, value) => {
    expect(isOidcProviderConfigured({ ...complete, [field]: value })).toBe(
      false
    )
  })
})

describe('OIDC configuration migration', () => {
  it('defaults to SSO disabled when an older configuration has no OIDC settings', () => {
    const { oidc, ...generalWithoutOidc } = DEFAULT_CONFIG.settings.general
    const parsed = configSchema.parse({
      ...DEFAULT_CONFIG,
      settings: {
        ...DEFAULT_CONFIG.settings,
        general: {
          ...generalWithoutOidc,
          registrations: { enabled: false, disabledMessage: 'Invite only' },
        },
      },
    })

    expect(parsed.settings.general.oidc).toEqual(oidc)
    expect(parsed.settings.general.oidc).toMatchObject({
      enabled: false,
      autoProvision: true,
      requireEmailVerified: true,
      enforceSso: false,
    })
    expect(parsed.settings.general.oidc).not.toHaveProperty('allowLinking')
    expect(parsed.settings.general.registrations).toEqual({
      enabled: false,
      disabledMessage: 'Invite only',
    })
  })

  it('discards persisted allowLinking while preserving the other SSO policies', () => {
    const currentOidc = {
      ...complete,
      autoProvision: false,
      requireEmailVerified: false,
      enforceSso: true,
    }
    const parsed = configSchema.parse({
      ...DEFAULT_CONFIG,
      settings: {
        ...DEFAULT_CONFIG.settings,
        general: {
          ...DEFAULT_CONFIG.settings.general,
          oidc: { ...currentOidc, allowLinking: true },
        },
      },
    })

    expect(parsed.settings.general.oidc).toEqual(currentOidc)
    expect(parsed.settings.general.oidc).not.toHaveProperty('allowLinking')
  })
})

describe('getOidcErrorMessage', () => {
  const knownCodes = [
    'OidcNoEmail',
    'OidcAccountExists',
    'OidcNotProvisioned',
    'OidcEmailUnverified',
  ] as const
  const fallback = getOidcErrorMessage('SomeUnrecognizedCode')

  it.each(knownCodes)('returns a specific message for %s', (code) => {
    const message = getOidcErrorMessage(code)
    expect(message).toBeTruthy()
    expect(message).not.toBe(fallback)
  })

  it('returns distinct messages for every known error code', () => {
    const messages = knownCodes.map(getOidcErrorMessage)
    expect(new Set(messages).size).toBe(knownCodes.length)
  })

  it('directs account collisions to local sign-in or the previously linked identity', () => {
    const message = getOidcErrorMessage('OidcAccountExists')

    expect(message).toContain('local sign-in')
    expect(message).toContain('previously linked SSO identity')
    expect(message).not.toContain('linking is disabled')
  })

  it('falls back to a generic message for an unrecognized code', () => {
    expect(fallback).toBe(
      'Sign-in with SSO failed. Please try again or contact an admin.'
    )
  })
})
