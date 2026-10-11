import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_INVITE_LIMITS,
  expiryOptionsFor,
  inviteCreateSchema,
  inviteStatus,
  inviteUrl,
  usesOptionsFor,
} from '@/lib/invites/policy'
import {
  createInviteToken,
  hashInviteToken,
  isInviteToken,
  readInviteToken,
} from '@/lib/invites/tokens'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import { settingsPatchAllowed } from '@/lib/permissions/settings'

describe('invite policy', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('keeps invites administrator-only by default', () => {
    expect(ALL_PERMISSIONS).toEqual(
      expect.arrayContaining(['invites.create', 'invites.manage'])
    )
    expect(DEFAULT_PERMISSIONS).not.toContain('invites.create')
    expect(DEFAULT_PERMISSIONS).not.toContain('invites.manage')
  })

  it('reports permanent endings before a temporary expiry', () => {
    const now = new Date('2026-10-11T12:00:00Z')
    const base = { revokedAt: null, expiresAt: null, maxUses: 1, uses: 0 }
    expect(inviteStatus(base, now)).toBe('active')
    expect(inviteStatus({ ...base, uses: 1 }, now)).toBe('used')
    expect(
      inviteStatus({ ...base, expiresAt: '2026-10-11T12:00:00Z' }, now)
    ).toBe('expired')
    expect(
      inviteStatus({ ...base, uses: 1, expiresAt: '2026-10-10T00:00:00Z' }, now)
    ).toBe('used')
    expect(inviteStatus({ ...base, revokedAt: new Date(), uses: 1 }, now)).toBe(
      'revoked'
    )
    expect(inviteStatus({ ...base, maxUses: null, uses: 500 }, now)).toBe(
      'active'
    )
  })

  it('offers only choices within member limits', () => {
    expect(usesOptionsFor(null)).toContain(null)
    expect(expiryOptionsFor(null).map((option) => option.hours)).toContain(null)
    expect(usesOptionsFor(DEFAULT_INVITE_LIMITS)).toEqual([1])
    expect(
      usesOptionsFor({ ...DEFAULT_INVITE_LIMITS, usesPerInvite: 7 })
    ).toEqual([1, 5, 7])
    expect(expiryOptionsFor(DEFAULT_INVITE_LIMITS)).toEqual([
      { hours: 1, label: '1 hour' },
      { hours: 24, label: '1 day' },
      { hours: 168, label: '7 days' },
      { hours: 720, label: '30 days' },
    ])
    expect(
      expiryOptionsFor({ ...DEFAULT_INVITE_LIMITS, lifetimeDays: 3 }).at(-1)
    ).toEqual({ hours: 72, label: '3 days' })
    expect(
      expiryOptionsFor({ ...DEFAULT_INVITE_LIMITS, lifetimeDays: 1 })
    ).toEqual([
      { hours: 1, label: '1 hour' },
      { hours: 24, label: '1 day' },
    ])
  })

  it('validates create requests with safe defaults', () => {
    expect(inviteCreateSchema.parse({})).toEqual({
      note: '',
      maxUses: 1,
      expiresInHours: 168,
      roleIds: [],
    })
    expect(
      inviteCreateSchema.parse({
        note: '  For Sam  ',
        maxUses: null,
        expiresInHours: null,
      })
    ).toMatchObject({ note: 'For Sam', maxUses: null, expiresInHours: null })
    for (const input of [
      { note: 'x'.repeat(101) },
      { maxUses: 0 },
      { maxUses: 1001 },
      { maxUses: 1.5 },
      { expiresInHours: 0 },
      { expiresInHours: 8761 },
      { roleIds: Array.from({ length: 101 }, (_, index) => `r${index}`) },
      { token: 'chosen-by-client' },
    ])
      expect(inviteCreateSchema.safeParse(input).success).toBe(false)
  })

  it('builds links on the current origin', () => {
    expect(inviteUrl('https://files.example/', 'abc_DEF-123')).toBe(
      'https://files.example/auth/register?invite=abc_DEF-123'
    )
  })

  it('requires Security settings to change member limits', () => {
    const limits = {
      general: { registrations: { inviteLimits: { activeInvites: 3 } } },
    }
    expect(
      settingsPatchAllowed({ permissions: ['settings.security'] }, limits)
    ).toBe(true)
    expect(
      settingsPatchAllowed({ permissions: ['settings.general'] }, limits)
    ).toBe(false)
  })
})

describe('invite tokens', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('stores only a digest and an encrypted copy of a 256-bit token', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'invite-unit-tests-'.padEnd(48, 'x'))
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    const generated = createInviteToken()
    expect(isInviteToken(generated.token)).toBe(true)
    expect(generated.hash).toBe(hashInviteToken(generated.token))
    expect(generated.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(generated.encrypted).not.toContain(generated.token)
    expect(readInviteToken(generated.encrypted)).toBe(generated.token)
    expect(createInviteToken().token).not.toBe(generated.token)
    expect(isInviteToken('short')).toBe(false)
    expect(isInviteToken(`${generated.token}=`)).toBe(false)
    expect(isInviteToken(42)).toBe(false)
  })

  it('cannot copy a link again after the encryption key changes', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'invite-unit-tests-'.padEnd(48, 'x'))
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    const generated = createInviteToken()
    vi.stubEnv('NEXTAUTH_SECRET', 'rotated-invite-key-'.padEnd(48, 'y'))
    expect(readInviteToken(generated.encrypted)).toBeNull()
    expect(readInviteToken('not encrypted')).toBeNull()
  })

  it('refuses to create links without an encryption key', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'short')
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    expect(() => createInviteToken()).toThrow('at least 32 characters')
  })
})
