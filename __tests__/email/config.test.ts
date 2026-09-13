import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import {
  emailEnvironmentName,
  redactEmailConfig,
  resolveEmailConfig,
  transitionEmailPolicy,
} from '@/lib/email/config'
import { encryptSecret } from '@/lib/email/crypto'
import {
  DEFAULT_EMAIL_CONFIG,
  emailConfigSchema,
  validateEnabledEmail,
} from '@/lib/email/schema'
import { sanitizeLogUrl } from '@/lib/logger/url'

afterEach(() => vi.unstubAllEnvs())

describe('email upgrade and configuration boundaries', () => {
  it('adds disabled email defaults to old config without changing any existing setting', () => {
    const legacy = structuredClone(DEFAULT_CONFIG)
    delete (legacy.settings as Partial<typeof legacy.settings>).email
    legacy.settings.general.registrations.enabled = false
    legacy.settings.general.oidc.enforceSso = true
    const upgraded = configSchema.parse(legacy)
    expect(upgraded.settings.email).toEqual(DEFAULT_EMAIL_CONFIG)
    expect(upgraded.settings.general).toEqual(legacy.settings.general)
    expect(upgraded.settings.appearance).toEqual(legacy.settings.appearance)
  })

  it('does not infer activation or enforcement from SMTP credentials', () => {
    const { config } = resolveEmailConfig(
      {},
      {
        FLARE_EMAIL_SMTP_HOST: 'smtp.example.test',
        FLARE_EMAIL_SMTP_PASSWORD: 'secret',
      }
    )
    expect(config.enabled).toBe(false)
    expect(config.recovery.enabled).toBe(false)
    expect(config.verification.mode).toBe('off')
  })

  it('applies typed environment overrides and reports which controls are managed', () => {
    const { config, managedFields } = resolveEmailConfig(
      {},
      {
        FLARE_EMAIL_SMTP_PORT: '587',
        FLARE_EMAIL_SMTP_AUTHENTICATION: 'false',
        NEXTAUTH_URL: 'https://flare.example.test/',
      }
    )
    expect(config.smtp.port).toBe(587)
    expect(config.smtp.authentication).toBe(false)
    expect(config.publicUrl).toBe('https://flare.example.test')
    expect(managedFields).toEqual(['smtp.port', 'smtp.authentication'])
    expect(emailEnvironmentName('verification.adminCreated')).toBe(
      'FLARE_EMAIL_VERIFICATION_ADMIN_CREATED'
    )
  })

  it('rejects ambiguous and out-of-bounds deployment settings', () => {
    expect(() =>
      resolveEmailConfig({}, { FLARE_EMAIL_ENABLED: 'yes' })
    ).toThrow('true or false')
    expect(() =>
      resolveEmailConfig({}, { FLARE_EMAIL_SMTP_PORT: '1;2' })
    ).toThrow('integer')
    expect(() =>
      resolveEmailConfig({}, { FLARE_EMAIL_SMTP_PORT: '70000' })
    ).toThrow()
    expect(() =>
      resolveEmailConfig(
        {},
        {
          FLARE_EMAIL_SMTP_PASSWORD: 'x',
          FLARE_EMAIL_SMTP_PASSWORD_FILE: '/tmp/no-secret',
        }
      )
    ).toThrow('only one')
  })

  it('can disable email after key loss without making authentication depend on decryption', () => {
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'test-only-stable-secret-at-least-32-characters'
    )
    const saved = emailConfigSchema.parse({
      enabled: true,
      smtp: { password: encryptSecret('smtp-secret') },
    })
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'different-test-only-secret-at-least-32-characters'
    )
    const { config } = resolveEmailConfig(saved, {
      FLARE_EMAIL_ENABLED: 'false',
    })
    expect(config.enabled).toBe(false)
    expect(redactEmailConfig(config).smtp.password).toBe('')
  })

  it('rejects public HTTP recovery links and header injection', () => {
    const config = emailConfigSchema.parse({
      enabled: true,
      smtp: { host: 'smtp.example.test', authentication: false },
      fromAddress: 'flare@example.test',
      publicUrl: 'http://flare.example.test',
    })
    expect(() => validateEnabledEmail(config)).toThrow('HTTPS')
    expect(() =>
      emailConfigSchema.parse({ fromName: 'Flare\r\nBcc: victim@example.test' })
    ).toThrow()
    expect(() =>
      emailConfigSchema.parse({
        publicUrl: 'https://user:password@example.test',
      })
    ).toThrow()
  })

  it('removes recovery tokens and credentials from request log URLs', () => {
    expect(
      sanitizeLogUrl(
        'https://user:secret@flare.example.test/auth/reset-password?token=secret-token#fragment'
      )
    ).toBe('https://flare.example.test/auth/reset-password')
    expect(sanitizeLogUrl('/auth/verify-email?token=secret')).toBe(
      '/auth/verify-email'
    )
  })

  it('does not accept operator overrides of internal policy dates or state', () => {
    const { config, managedFields } = resolveEmailConfig(
      {},
      {
        FLARE_EMAIL_VERIFICATION_REQUIRED_SINCE: '',
        FLARE_EMAIL_VERIFICATION_APPLIED_MODE: 'all_users',
      }
    )
    expect(config.verification.requiredSince).toBeNull()
    expect(config.verification.appliedMode).toBe('off')
    expect(managedFields).toEqual([])
  })

  it('gives existing users grace on new-users to all-users transitions and refreshes reactivation boundaries', () => {
    const base = structuredClone(DEFAULT_EMAIL_CONFIG)
    const newUsers: typeof base = {
      ...base,
      enabled: true,
      verification: { ...base.verification, mode: 'new_users' as const },
    }
    newUsers.verification = transitionEmailPolicy(
      base,
      newUsers,
      new Date('2026-01-01')
    )
    const everyone = {
      ...newUsers,
      verification: { ...newUsers.verification, mode: 'all_users' as const },
    }
    expect(
      transitionEmailPolicy(newUsers, everyone, new Date('2026-02-01'))
        .graceEndsAt
    ).toBe('2026-02-08T00:00:00.000Z')
    const disabled = { ...newUsers, enabled: false }
    disabled.verification = transitionEmailPolicy(
      newUsers,
      disabled,
      new Date('2026-03-01')
    )
    expect(
      transitionEmailPolicy(disabled, newUsers, new Date('2026-04-01'))
        .requiredSince
    ).toBe('2026-04-01T00:00:00.000Z')
  })
})
