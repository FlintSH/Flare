import { beforeEach, describe, expect, it, vi } from 'vitest'

import { signInWithPasskey } from '@/components/auth/passkey-sign-in'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  authenticate: vi.fn(),
  signIn: vi.fn(),
}))

vi.mock('@/components/auth/security-api', () => ({
  securityRequest: mocks.request,
}))
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: mocks.authenticate,
}))
vi.mock('next-auth/react', () => ({ signIn: mocks.signIn }))

describe('browser passkey confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockResolvedValue({
      options: { challenge: 'public-test-challenge' },
      challengeId: 'public-test-id',
    })
    mocks.authenticate.mockResolvedValue({ id: 'public-test-credential' })
    mocks.signIn.mockResolvedValue({ ok: true, error: null })
  })

  it('binds in-place confirmation to the account currently being edited, without navigating', async () => {
    await signInWithPasskey('current-account-id')
    expect(mocks.signIn).toHaveBeenCalledWith(
      'passkey',
      expect.objectContaining({
        expectedUserId: 'current-account-id',
        challengeId: 'public-test-id',
        response: JSON.stringify({ id: 'public-test-credential' }),
        redirect: false,
      })
    )
  })

  it('keeps account discovery available for normal passkey sign-in', async () => {
    await signInWithPasskey()
    expect(mocks.signIn.mock.calls[0][1]).not.toHaveProperty('expectedUserId')
  })

  it('does not treat a rejected account confirmation as a success', async () => {
    mocks.signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' })
    await expect(signInWithPasskey('current-account-id')).rejects.toThrow(
      /passkey registered to the account you are editing/
    )
  })

  it('does not submit credentials after the device ceremony is canceled', async () => {
    const canceled = new Error('Canceled')
    canceled.name = 'NotAllowedError'
    mocks.authenticate.mockRejectedValue(canceled)
    await expect(signInWithPasskey('current-account-id')).rejects.toBe(canceled)
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('stops before the device ceremony when challenge creation fails', async () => {
    mocks.request.mockRejectedValue(new Error('Challenge unavailable'))
    await expect(signInWithPasskey()).rejects.toThrow('Challenge unavailable')
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
  })
})
