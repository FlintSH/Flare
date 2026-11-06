import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emailPost, emailRequest } from '@/components/email/api'

import {
  RefusedRequest,
  accountRequest,
  refusal,
  updateProfile,
} from '@/lib/client/account-request'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sent = () => fetchMock.mock.calls[0][1] as RequestInit

describe('accountRequest', () => {
  it('reads one shape from every account endpoint envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { name: 'Alex' }, success: true })
    )
    await expect(accountRequest('/api/profile')).resolves.toEqual({
      name: 'Alex',
    })

    fetchMock.mockResolvedValueOnce(Response.json({ sessions: [] }))
    await expect(accountRequest('/api/profile/sessions')).resolves.toEqual({
      sessions: [],
    })

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(
      accountRequest('/api/profile', { method: 'DELETE' })
    ).resolves.toEqual({})
  })

  it('sends a body as JSON with POST unless a method is given', async () => {
    fetchMock.mockImplementation(async () => Response.json({}))
    await accountRequest('/api/auth/security/totp/disable', {
      body: { currentPassword: 'secret' },
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/security/totp/disable',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{"currentPassword":"secret"}',
      })
    )

    await accountRequest('/api/upload-profiles/default', {
      method: 'PUT',
      body: { profileId: null },
    })
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ method: 'PUT' })
  })

  it('reads with GET and no content type when there is no body', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(Response.json({ attempts: [] }))
    await accountRequest('/api/profile/login-history?outcome=all', {
      signal: controller.signal,
    })
    expect(sent()).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    expect(sent().headers).toBeUndefined()
    expect(sent().body).toBeUndefined()
  })

  it('rejects with the server’s reason, or the caller’s fallback when it gives none', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { success: false, error: 'This vanity URL is already taken' },
        { status: 400 }
      )
    )
    const refused = accountRequest('/api/profile', {
      method: 'PUT',
      body: { vanityId: 'taken' },
      fallback: 'Failed to update vanity URL',
    })
    await expect(refused).rejects.toBeInstanceOf(RefusedRequest)
    await expect(refused).rejects.toThrow('This vanity URL is already taken')

    fetchMock.mockResolvedValueOnce(
      new Response('<html>Bad gateway</html>', { status: 502 })
    )
    await expect(
      accountRequest('/api/upload-profiles', {
        body: {},
        fallback: 'Could not save your changes.',
      })
    ).rejects.toThrow('Could not save your changes.')

    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 500 }))
    await expect(accountRequest('/api/auth/security')).rejects.toThrow(
      'Unable to complete this request. Please try again.'
    )
  })

  it('does not resolve once its signal aborts, even after the answer arrived', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async () => {
      controller.abort()
      return Response.json({ signedOut: true, revokedCount: 1 })
    })
    await expect(
      accountRequest('/api/profile/sessions', {
        method: 'DELETE',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('passes network failures through unchanged', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const failed = accountRequest('/api/profile/upload-token')
    await expect(failed).rejects.toThrow('Failed to fetch')
    await expect(failed).rejects.not.toBeInstanceOf(RefusedRequest)
  })

  it('rejects a successful answer that is not JSON, such as a proxy’s sign-in page', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Sign in to continue</html>', {
        headers: { 'Content-Type': 'text/html' },
      })
    )
    const answered = accountRequest('/api/profile/sessions', {
      fallback: 'Unable to load account activity. Please try again.',
    })
    await expect(answered).rejects.toBeInstanceOf(RefusedRequest)
    await expect(answered).rejects.toThrow(
      'Unable to load account activity. Please try again.'
    )
  })
})

describe('email requests', () => {
  it('read like account requests and send the same requests as before', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ enabled: true, recoveryEnabled: false })
    )
    await expect(emailRequest('/api/auth/email/capabilities')).resolves.toEqual(
      { enabled: true, recoveryEnabled: false }
    )
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/email/capabilities', {
      cache: 'no-store',
    })

    const settings = { config: {}, clearPassword: false }
    const init = {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }
    fetchMock.mockResolvedValueOnce(Response.json({ data: { config: {} } }))
    await expect(emailRequest('/api/settings/email', init)).resolves.toEqual({
      config: {},
    })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings/email', {
      cache: 'no-store',
      ...init,
    })

    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Email sent.' }))
    await expect(emailPost('/api/auth/email/resend', {})).resolves.toEqual({
      message: 'Email sent.',
    })
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  })

  it('reject with the server’s reason or the general message', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: 'This email address is unavailable.' },
        { status: 400 }
      )
    )
    await expect(
      emailPost('/api/auth/email/change', { email: 'taken@example.test' })
    ).rejects.toThrow('This email address is unavailable.')

    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(emailRequest('/api/auth/email/status')).rejects.toThrow(
      'Unable to complete this request. Please try again.'
    )
  })
})

describe('updateProfile', () => {
  it('saves fields with PUT /api/profile and returns the saved profile', async () => {
    const profile = {
      id: 'user-1',
      name: 'Alex',
      email: 'alex@example.test',
      image: null,
      randomizeFileUrls: true,
      vanityId: null,
    }
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: profile, success: true })
    )
    await expect(updateProfile({ randomizeFileUrls: true })).resolves.toEqual(
      profile
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/profile',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"randomizeFileUrls":true}',
      })
    )
  })
})

describe('refusal', () => {
  it('turns a refused download into an error with the server’s reason', async () => {
    const error = await refusal(
      Response.json({ error: 'Upload profile not found.' }, { status: 404 }),
      'Failed to download ShareX configuration'
    )
    expect(error).toBeInstanceOf(RefusedRequest)
    expect(error.message).toBe('Upload profile not found.')
    expect(
      (
        await refusal(
          new Response('', { status: 500 }),
          'Failed to download ShareX configuration'
        )
      ).message
    ).toBe('Failed to download ShareX configuration')
  })
})
