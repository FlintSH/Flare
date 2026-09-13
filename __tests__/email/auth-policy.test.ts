import { describe, expect, it } from 'vitest'

import {
  type EmailPolicyUser,
  canRecoverPassword,
  hasVerifiedEmail,
  requiresEmailVerification,
} from '@/lib/email/policy'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'

const legacy: EmailPolicyUser & { password: string | null } = {
  email: 'owner@example.com',
  emailVerified: new Date('2020-01-01'),
  emailVerifiedFor: null,
  emailVerificationSource: null,
  emailExempt: false,
  createdAt: new Date('2020-01-01'),
  password: 'hash',
}
const enabled = {
  ...DEFAULT_EMAIL_CONFIG,
  enabled: true,
  recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true },
}
const proof = {
  ...legacy,
  emailVerifiedFor: legacy.email,
  emailVerificationSource: 'email',
}

describe('email access and recovery policies', () => {
  it('preserves legacy access under disabled defaults, including arbitrary timestamps', () => {
    expect(requiresEmailVerification(legacy, DEFAULT_EMAIL_CONFIG)).toBe(false)
    expect(canRecoverPassword(legacy, DEFAULT_EMAIL_CONFIG)).toBe(false)
  })
  it('does not turn a setup stamp or exemption into mailbox proof', () => {
    expect(hasVerifiedEmail(legacy)).toBe(false)
    expect(canRecoverPassword({ ...legacy, emailExempt: true }, enabled)).toBe(
      false
    )
    expect(
      hasVerifiedEmail({ ...legacy, emailVerifiedFor: legacy.email })
    ).toBe(false)
  })
  it('requires proof bound to the current address and a local password for recovery', () => {
    expect(canRecoverPassword(proof, enabled)).toBe(true)
    expect(
      canRecoverPassword({ ...proof, email: 'changed@example.com' }, enabled)
    ).toBe(false)
    expect(canRecoverPassword({ ...proof, password: null }, enabled)).toBe(
      false
    )
  })
  it('stops trusting provider proof when the administrator turns that trust off', () => {
    const oidcProof = { ...proof, emailVerificationSource: 'oidc' }
    expect(hasVerifiedEmail(oidcProof, enabled)).toBe(false)
    const trusted = {
      ...enabled,
      verification: { ...enabled.verification, trustOidc: true },
    }
    expect(hasVerifiedEmail(oidcProof, trusted)).toBe(true)
    expect(canRecoverPassword(oidcProof, enabled)).toBe(false)
  })
  it('requires new users immediately while grandfathering earlier accounts', () => {
    const config = {
      ...enabled,
      verification: {
        ...enabled.verification,
        mode: 'new_users' as const,
        requiredSince: '2026-01-01T00:00:00.000Z',
        graceDays: 30,
      },
    }
    expect(requiresEmailVerification(legacy, config)).toBe(false)
    expect(
      requiresEmailVerification(
        { ...legacy, createdAt: new Date('2026-01-02') },
        config,
        new Date('2026-01-02')
      )
    ).toBe(true)
    expect(
      requiresEmailVerification(
        { ...proof, createdAt: new Date('2026-01-02') },
        config
      )
    ).toBe(false)
  })
  it('applies all-user grace only to accounts that predate enforcement', () => {
    const config = {
      ...enabled,
      verification: {
        ...enabled.verification,
        mode: 'all_users' as const,
        requiredSince: '2026-01-01T00:00:00.000Z',
        graceEndsAt: '2026-02-01T00:00:00.000Z',
      },
    }
    expect(
      requiresEmailVerification(legacy, config, new Date('2026-01-15'))
    ).toBe(false)
    expect(
      requiresEmailVerification(legacy, config, new Date('2026-02-02'))
    ).toBe(true)
    expect(
      requiresEmailVerification(
        { ...legacy, createdAt: new Date('2026-01-10') },
        config,
        new Date('2026-01-15')
      )
    ).toBe(true)
    expect(
      requiresEmailVerification(
        { ...legacy, emailExempt: true },
        config,
        new Date('2026-02-02')
      )
    ).toBe(false)
  })
  it('turning delivery off immediately releases required access without changing proof', () => {
    const config = {
      ...enabled,
      enabled: false,
      verification: { ...enabled.verification, mode: 'all_users' as const },
    }
    expect(requiresEmailVerification(legacy, config)).toBe(false)
    expect(canRecoverPassword(proof, config)).toBe(false)
  })
})
