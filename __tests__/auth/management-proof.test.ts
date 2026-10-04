import { describe, expect, it, vi } from 'vitest'

import type { SecurityStatus } from '@/components/auth/security-api'
import { checkManagementProof } from '@/components/profile/security/management-proof'

const status: SecurityStatus = {
  hasPassword: true,
  twoFactorEnabled: true,
  recoveryCodesRemaining: 5,
  passkeys: [],
  passkeysAvailable: true,
  canUseRecentPasskey: false,
  canUseRecentRecovery: false,
  canUseRecentPasskeyRecovery: false,
  canUseRecentSso: false,
  passkeyRequired: false,
  passkeyRecoveryCodesRemaining: 0,
}

describe('security dialog proof preflight', () => {
  it.each(['canUseRecentPasskey', 'canUseRecentRecovery'] as const)(
    'stops an optional-mode change after %s expires until newly required proof is supplied',
    async (method) => {
      const refresh = vi
        .fn()
        .mockResolvedValueOnce({
          data: { ...status, [method]: true },
          error: null,
        })
        .mockResolvedValue({ data: status, error: null })
      expect(await checkManagementProof(refresh, {})).toBeNull()
      expect(await checkManagementProof(refresh, {})).toMatch(
        /current password/
      )
      expect(
        await checkManagementProof(refresh, {
          password: 'public-test-password',
        })
      ).toMatch(/authenticator or recovery code/)
      expect(
        await checkManagementProof(refresh, {
          password: 'public-test-password',
          code: '123456',
        })
      ).toBeNull()
      expect(refresh).toHaveBeenCalledTimes(4)
    }
  )

  it('restores SSO confirmation after a provider sign-in expires', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ...status, hasPassword: false, canUseRecentSso: true },
        error: null,
      })
      .mockResolvedValue({
        data: { ...status, hasPassword: false },
        error: null,
      })
    expect(await checkManagementProof(refresh, {})).toBeNull()
    expect(await checkManagementProof(refresh, {})).toMatch(/SSO again/)
  })

  it('accepts only a password when optional-mode two-factor authentication is off', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: { ...status, twoFactorEnabled: false },
      error: null,
    })
    expect(
      await checkManagementProof(refresh, { password: 'public-test-password' })
    ).toBeNull()
  })

  it('does not treat an authenticator recovery sign-in or filled credentials as required-mode proof', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: { ...status, passkeyRequired: true, canUseRecentRecovery: true },
      error: null,
    })
    expect(
      await checkManagementProof(refresh, {
        password: 'public-test-password',
        code: '123456',
      })
    ).toMatch(/Confirm with a passkey/)
  })

  it('permits dedicated recovery to repair required-mode settings but requires an actual passkey to activate the mode', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: {
        ...status,
        passkeyRequired: true,
        canUseRecentPasskeyRecovery: true,
      },
      error: null,
    })
    expect(await checkManagementProof(refresh, {})).toBeNull()
    expect(await checkManagementProof(refresh, {}, true)).toMatch(
      /Confirm with a passkey/
    )
  })

  it('fails closed when a refresh fails even if cached data claims proof remains fresh', async () => {
    const failure = new Error('Security status unavailable')
    const refresh = vi.fn().mockResolvedValue({
      data: { ...status, canUseRecentPasskey: true },
      error: failure,
    })
    await expect(checkManagementProof(refresh, {})).rejects.toBe(failure)
  })
})
