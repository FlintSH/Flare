import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type EmailStatusUser,
  accountEmailStatus,
  emailCapabilities,
  userEmailStatus,
} from '@/lib/email/eligibility'
import { emailLinkAvailable, isEmailLinkPurpose } from '@/lib/email/links'
import { satisfiesEmailPolicy } from '@/lib/email/policy'
import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/email/schema'

const sso = { enabled: false, enforceSso: false }
const verified: EmailStatusUser = {
  email: 'owner@example.com',
  emailVerified: new Date('2025-06-01'),
  emailVerifiedFor: 'owner@example.com',
  emailVerificationSource: 'email',
  emailExempt: false,
  createdAt: new Date('2025-01-01'),
  password: 'hash',
  pendingEmail: null,
}
const unverified: EmailStatusUser = {
  ...verified,
  emailVerified: null,
  emailVerifiedFor: null,
  emailVerificationSource: null,
}

function config(changes: Partial<EmailConfig> = {}): EmailConfig {
  return {
    ...structuredClone(DEFAULT_EMAIL_CONFIG),
    enabled: true,
    ...changes,
  }
}

function allUsers(enabled = true): EmailConfig {
  return config({
    enabled,
    verification: {
      ...DEFAULT_EMAIL_CONFIG.verification,
      mode: 'all_users',
      appliedMode: 'all_users',
      requiredSince: '2026-01-01T00:00:00.000Z',
      graceEndsAt: '2026-02-01T00:00:00.000Z',
    },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T00:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

describe('email capabilities', () => {
  it('report nothing while email is disabled, whatever is saved', () => {
    expect(
      emailCapabilities(allUsers(false), { enabled: true, enforceSso: false })
    ).toEqual({
      enabled: false,
      recoveryEnabled: false,
      verificationMode: 'off',
      changesEnabled: false,
    })
  })

  it('turn recovery off only while SSO is enforced', () => {
    const recovery = config({
      recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true },
    })
    expect(emailCapabilities(recovery, sso).recoveryEnabled).toBe(true)
    expect(
      emailCapabilities(recovery, { enabled: true, enforceSso: false })
        .recoveryEnabled
    ).toBe(true)
    expect(
      emailCapabilities(recovery, { enabled: true, enforceSso: true })
        .recoveryEnabled
    ).toBe(false)
  })
})

describe('account email status', () => {
  it('keeps every earlier field and its value', () => {
    const status = accountEmailStatus(
      { ...unverified, emailVerificationSource: 'pending_local' },
      config(),
      sso
    )
    expect(status).toEqual({
      enabled: true,
      recoveryEnabled: false,
      verificationMode: 'off',
      verified: false,
      exempt: false,
      required: false,
      pendingEmail: null,
      canChangeEmail: true,
      canEnroll: true,
      canResend: true,
      hasPassword: true,
      requiresPassword: true,
      requiresOldEmail: false,
      resendSeconds: 60,
      graceEndsAt: null,
      canRequestChange: true,
      verifyBy: null,
    })
  })

  it('reports the saved mode while email is disabled, unlike the capabilities', () => {
    const status = accountEmailStatus(unverified, allUsers(false), sso)
    expect(status.verificationMode).toBe('all_users')
    expect(status).toMatchObject({
      enabled: false,
      canChangeEmail: false,
      canRequestChange: false,
      canEnroll: false,
      canResend: false,
      verifyBy: null,
    })
  })

  it('lets an unverified address request a change only when the old address need not approve it', () => {
    const approval = config({
      changes: { enabled: true, requireOldEmail: true },
    })
    expect(accountEmailStatus(unverified, approval, sso)).toMatchObject({
      canChangeEmail: true,
      canRequestChange: false,
    })
    expect(accountEmailStatus(verified, approval, sso)).toMatchObject({
      canChangeEmail: true,
      canRequestChange: true,
    })
    expect(
      accountEmailStatus(
        verified,
        config({ changes: { enabled: false, requireOldEmail: false } }),
        sso
      )
    ).toMatchObject({ canChangeEmail: false, canRequestChange: false })
  })

  it('gives the grace deadline only to accounts the grace period still lets in', () => {
    expect(accountEmailStatus(unverified, allUsers(), sso)).toMatchObject({
      required: false,
      verifyBy: '2026-02-01T00:00:00.000Z',
      graceEndsAt: '2026-02-01T00:00:00.000Z',
    })
    for (const user of [
      verified,
      { ...unverified, emailExempt: true },
      // Created after enforcement started: verification is required now.
      { ...unverified, createdAt: new Date('2026-01-10') },
    ])
      expect(accountEmailStatus(user, allUsers(), sso).verifyBy).toBeNull()
    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'))
    expect(accountEmailStatus(unverified, allUsers(), sso)).toMatchObject({
      required: true,
      verifyBy: null,
    })
  })

  it('carries the password state in both password fields', () => {
    const status = accountEmailStatus(
      { ...verified, password: null },
      config(),
      sso
    )
    expect(status.hasPassword).toBe(false)
    expect(status.requiresPassword).toBe(false)
  })
})

describe('administrator email status', () => {
  it('offers a resend only for an enrolled, unverified address', () => {
    expect(userEmailStatus(unverified, config()).canResend).toBe(false)
    expect(
      userEmailStatus(
        { ...unverified, emailVerificationSource: 'pending_local' },
        config()
      )
    ).toEqual({
      verified: false,
      exempt: false,
      required: false,
      pendingEmail: null,
      canResend: true,
    })
    expect(
      userEmailStatus(
        { ...verified, emailVerificationSource: 'email' },
        config()
      ).canResend
    ).toBe(false)
  })
})

describe('email links', () => {
  it('need email and their own feature to be on', () => {
    const off = config({
      recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: false },
      changes: { enabled: false, requireOldEmail: false },
    })
    expect(emailLinkAvailable(off, 'verify')).toBe(true)
    expect(emailLinkAvailable(off, 'reset')).toBe(false)
    expect(emailLinkAvailable(off, 'change')).toBe(false)
    expect(emailLinkAvailable(off, 'change_approval')).toBe(false)
    expect(emailLinkAvailable({ ...off, enabled: false }, 'verify')).toBe(false)
  })

  it('are told apart from notices without a link', () => {
    expect(isEmailLinkPurpose('change_approval')).toBe(true)
    for (const purpose of ['password_changed', 'test', 'toString'])
      expect(isEmailLinkPurpose(purpose)).toBe(false)
  })
})

describe('the all-user impact preview', () => {
  it('counts an account as affected unless it is exempt or verified', () => {
    expect(satisfiesEmailPolicy(unverified, config())).toBe(false)
    expect(
      satisfiesEmailPolicy({ ...unverified, emailExempt: true }, config())
    ).toBe(true)
    expect(satisfiesEmailPolicy(verified, config())).toBe(true)
  })
})
