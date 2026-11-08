import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { signInWithPasskey } from '@/components/auth/passkey-sign-in'

import { RefusedRequest, TransportFailure } from '@/lib/client/request'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  authenticate: vi.fn(),
  signIn: vi.fn(),
}))

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: mocks.authenticate,
}))
vi.mock('next-auth/react', () => ({ signIn: mocks.signIn }))

describe('browser passkey confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.fetch.mockImplementation(async () =>
      Response.json({
        options: { challenge: 'public-test-challenge' },
        challengeId: 'public-test-id',
      })
    )
    mocks.authenticate.mockResolvedValue({ id: 'public-test-credential' })
    mocks.signIn.mockResolvedValue({ ok: true, error: null })
  })
  afterEach(() => vi.unstubAllGlobals())

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

  it('requests the challenge with a POST, the only method its route takes', async () => {
    await signInWithPasskey()
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/auth/passkeys/options',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('does not treat a rejected account confirmation as a success', async () => {
    mocks.signIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' })
    await expect(signInWithPasskey('current-account-id')).rejects.toThrow(
      /passkey registered to the account you are editing/
    )
  })

  it('tells a throttled sign-in how long to wait', async () => {
    mocks.signIn.mockResolvedValue({ ok: false, error: 'TooManyAttempts' })
    await expect(signInWithPasskey()).rejects.toThrow(
      'Too many sign-in attempts. Wait 15 minutes before trying again.'
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
    const cause = new Error('Challenge unavailable')
    mocks.fetch.mockRejectedValueOnce(cause)
    const pending = signInWithPasskey()
    await expect(pending).rejects.toBeInstanceOf(TransportFailure)
    const failure = await pending.catch((error) => error)
    expect(failure.cause).toBe(cause)
    expect(failure.message).toBe(
      'Connection problem. Check the result before trying again.'
    )
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledOnce()

    // The same words in a real HTTP refusal remain the server's human reason.
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ error: 'Challenge unavailable' }, { status: 503 })
    )
    const refused = signInWithPasskey()
    await expect(refused).rejects.toBeInstanceOf(RefusedRequest)
    await expect(refused).rejects.toMatchObject({
      message: 'Challenge unavailable',
      status: 503,
    })
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
})
