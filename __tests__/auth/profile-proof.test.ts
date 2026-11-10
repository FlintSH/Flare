import { describe, expect, it, vi } from 'vitest'

import type { SecurityStatus } from '@/components/auth/security-api'
import { checkProfileProof } from '@/components/profile/security/profile-proof'

const status: SecurityStatus = {
  hasPassword: true,
  hasPassphrase: false,
  canUseRecentPassphrase: false,
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

describe('profile proof preflight', () => {
  it.each(['canUseRecentPasskey', 'canUseRecentRecovery'] as const)(
    'checks the server again after %s expires before submitting a password change',
    async (method) => {
      const refresh = vi
        .fn()
        .mockResolvedValueOnce({
          data: { ...status, [method]: true },
          error: null,
        })
        .mockResolvedValueOnce({ data: status, error: null })
      const proof = { currentPassword: 'public-test-password' }
      expect(await checkProfileProof(refresh, 'password', proof)).toBeNull()
      expect(await checkProfileProof(refresh, 'password', proof)).toMatch(
        /authenticator or recovery code/
      )
      expect(refresh).toHaveBeenCalledTimes(2)
    }
  )

  it('requests newly needed email fields and accepts a retry with the completed proof', async () => {
    const refresh = vi.fn().mockResolvedValue({ data: status, error: null })
    expect(await checkProfileProof(refresh, 'email', {})).toMatch(
      /current password/
    )
    expect(
      await checkProfileProof(refresh, 'email', {
        currentPassword: 'public-test-password',
      })
    ).toMatch(/authenticator or recovery code/)
    expect(
      await checkProfileProof(refresh, 'email', {
        currentPassword: 'public-test-password',
        securityCode: '123456',
      })
    ).toBeNull()
  })

  it('does not use retained query data when the refresh failed', async () => {
    const failure = new Error('Sign in again to continue.')
    const refresh = vi.fn().mockResolvedValue({
      data: { ...status, canUseRecentRecovery: true },
      error: failure,
    })
    await expect(checkProfileProof(refresh, 'email', {})).rejects.toBe(failure)
  })

  it('keeps the existing current-password requirement even when the second factor is fresh', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: { ...status, canUseRecentRecovery: true },
      error: null,
    })
    expect(await checkProfileProof(refresh, 'password', {})).toMatch(
      /current password/
    )
    expect(await checkProfileProof(refresh, 'email', {})).toBeNull()
  })

  it('prompts SSO-only accounts for a new confirmation after the SSO window expires', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ...status, hasPassword: false, canUseRecentSso: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...status, hasPassword: false },
        error: null,
      })
    expect(await checkProfileProof(refresh, 'email', {})).toBeNull()
    expect(await checkProfileProof(refresh, 'email', {})).toMatch(/SSO again/)
  })

  it('does not offer a password, authenticator, or old recovery proof as a fallback when passkeys are required', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: {
        ...status,
        passkeyRequired: true,
        canUseRecentRecovery: true,
        canUseRecentSso: true,
      },
      error: null,
    })
    const proof = {
      currentPassword: 'public-test-password',
      securityCode: '123456',
    }
    expect(await checkProfileProof(refresh, 'password', proof)).toMatch(
      /Confirm with a passkey/
    )
    expect(await checkProfileProof(refresh, 'email', proof)).toMatch(
      /Confirm with a passkey/
    )
  })

  it.each(['canUseRecentPasskey', 'canUseRecentPasskeyRecovery'] as const)(
    'restores passkey confirmation when required-mode %s expires before a mutation',
    async (method) => {
      const refresh = vi
        .fn()
        .mockResolvedValueOnce({
          data: { ...status, passkeyRequired: true, [method]: true },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { ...status, passkeyRequired: true },
          error: null,
        })
      const proof = { currentPassword: 'public-test-password' }
      expect(await checkProfileProof(refresh, 'password', proof)).toBeNull()
      expect(await checkProfileProof(refresh, 'password', proof)).toMatch(
        /Confirm with a passkey/
      )
    }
  )

  it('accepts dedicated recovery proof for an SSO-only required-mode email change without password fallback', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: {
        ...status,
        passkeyRequired: true,
        hasPassword: false,
        canUseRecentPasskeyRecovery: true,
      },
      error: null,
    })
    expect(await checkProfileProof(refresh, 'email', {})).toBeNull()
    expect(await checkProfileProof(refresh, 'password', {})).toMatch(
      /identity provider/
    )
  })

  it('asks an account with a passphrase for a recent passphrase sign-in before an email change', async () => {
    const keyed = { ...status, hasPassword: false, hasPassphrase: true }
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ data: keyed, error: null })
      .mockResolvedValueOnce({
        data: { ...keyed, canUseRecentPassphrase: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...keyed, canUseRecentPassphrase: true },
        error: null,
      })
      .mockResolvedValue({
        data: {
          ...keyed,
          canUseRecentPassphrase: true,
          twoFactorEnabled: false,
        },
        error: null,
      })
    expect(
      await checkProfileProof(refresh, 'email', {
        currentPassword: 'public-test-password',
      })
    ).toMatch(/Confirm your passphrase/)
    expect(await checkProfileProof(refresh, 'email', {})).toMatch(
      /authenticator or recovery code/
    )
    expect(
      await checkProfileProof(refresh, 'email', { securityCode: '123456' })
    ).toBeNull()
    expect(await checkProfileProof(refresh, 'email', {})).toBeNull()
  })

  it('sends a password change of a passphrase account to the passphrase section', async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: { ...status, hasPassword: false, hasPassphrase: true },
      error: null,
    })
    expect(
      await checkProfileProof(refresh, 'password', {
        currentPassword: 'public-test-password',
      })
    ).toMatch(/passphrase section/)
  })
})
