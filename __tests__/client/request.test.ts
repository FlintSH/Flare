import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchEmailCapabilities } from '@/components/email/api'

import { updateProfile } from '@/lib/client/profile'
import {
  RefusedRequest,
  apiRequest,
  refusal,
  retryable,
  sendRequest,
} from '@/lib/client/request'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sent = () => fetchMock.mock.calls[0][1] as RequestInit

describe('apiRequest', () => {
  it('reads one shape from every endpoint envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { name: 'Alex' }, success: true })
    )
    await expect(apiRequest('/api/profile')).resolves.toEqual({
      name: 'Alex',
    })

    fetchMock.mockResolvedValueOnce(Response.json({ sessions: [] }))
    await expect(apiRequest('/api/profile/sessions')).resolves.toEqual({
      sessions: [],
    })

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(
      apiRequest('/api/profile', { method: 'DELETE' })
    ).resolves.toEqual({})
  })

  it('keeps a whole answer when asked, such as a page with its pagination', async () => {
    const page = {
      data: [{ id: 'user-1' }],
      pagination: { page: 1, pageCount: 1, total: 1, limit: 25 },
      success: true,
    }
    fetchMock.mockResolvedValueOnce(Response.json(page))
    await expect(apiRequest('/api/users', { whole: true })).resolves.toEqual(
      page
    )
  })

  it('sends a body as JSON with POST unless a method is given', async () => {
    fetchMock.mockImplementation(async () => Response.json({}))
    await apiRequest('/api/auth/security/totp/disable', {
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

    await apiRequest('/api/upload-profiles/default', {
      method: 'PUT',
      body: { profileId: null },
    })
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({ method: 'PUT' })
  })

  it('sends form data as it is, so the browser sets its boundary', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }))
    const form = new FormData()
    form.append('file', new Blob(['avatar']), 'avatar.png')
    await apiRequest('/api/profile/avatar', { body: form })
    expect(sent()).toMatchObject({ method: 'POST', body: form })
    expect(sent().headers).toBeUndefined()
  })

  it('reads with GET and no content type when there is no body', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(Response.json({ attempts: [] }))
    await apiRequest('/api/profile/login-history?outcome=all', {
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
    const refused = apiRequest('/api/profile', {
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
      apiRequest('/api/upload-profiles', {
        body: {},
        fallback: 'Could not save your changes.',
      })
    ).rejects.toThrow('Could not save your changes.')

    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 500 }))
    await expect(apiRequest('/api/auth/security')).rejects.toThrow(
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
      apiRequest('/api/profile/sessions', {
        method: 'DELETE',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('passes network failures through unchanged', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const failed = apiRequest('/api/profile/upload-token')
    await expect(failed).rejects.toThrow('Failed to fetch')
    await expect(failed).rejects.not.toBeInstanceOf(RefusedRequest)
  })

  it('rejects a successful answer that is not JSON, such as a proxy’s sign-in page', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Sign in to continue</html>', {
        headers: { 'Content-Type': 'text/html' },
      })
    )
    const answered = apiRequest('/api/profile/sessions', {
      fallback: 'Unable to load account activity. Please try again.',
    })
    await expect(answered).rejects.toBeInstanceOf(RefusedRequest)
    await expect(answered).rejects.toThrow(
      'Unable to load account activity. Please try again.'
    )
  })
})

describe('sendRequest', () => {
  it('sends the request apiRequest sends and hands back the raw answer', async () => {
    const answer = new Response('{}', { status: 202 })
    fetchMock.mockResolvedValueOnce(answer)
    await expect(
      sendRequest('/api/files/id/archive/share', { body: { after: 3 } })
    ).resolves.toBe(answer)
    expect(sent()).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{"after":3}',
    })
  })
})

describe('refusal', () => {
  it('keeps the server’s reason, status, code and wait', async () => {
    const error = await refusal(
      Response.json(
        { error: 'This invite has been used.', code: 'invite_used' },
        { status: 409, headers: { 'Retry-After': '30' } }
      ),
      'Failed to register'
    )
    expect(error).toBeInstanceOf(RefusedRequest)
    expect(error).toMatchObject({
      message: 'This invite has been used.',
      status: 409,
      code: 'invite_used',
      retryAfter: 30,
    })
  })

  it('falls back to the caller’s message and leaves what the answer lacks empty', async () => {
    const error = await refusal(
      new Response('<html>Gateway timeout</html>', {
        status: 504,
        headers: { 'Retry-After': 'soon' },
      }),
      'Failed to download ShareX configuration'
    )
    expect(error).toMatchObject({
      message: 'Failed to download ShareX configuration',
      status: 504,
      code: null,
      retryAfter: null,
    })
  })
})

describe('retryable', () => {
  it('offers another attempt only when one can help', async () => {
    expect(retryable(new TypeError('Failed to fetch'))).toBe(true)
    for (const status of [408, 429, 500, 503])
      expect(retryable(new RefusedRequest('Busy', status)), `${status}`).toBe(
        true
      )
    for (const status of [400, 401, 403, 404, 409, 413])
      expect(
        retryable(new RefusedRequest('Refused', status)),
        `${status}`
      ).toBe(false)
  })
})

describe('email capabilities', () => {
  it('are read uncached like every other request', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ enabled: true, recoveryEnabled: false })
    )
    await expect(fetchEmailCapabilities()).resolves.toEqual({
      enabled: true,
      recoveryEnabled: false,
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/email/capabilities',
      expect.objectContaining({ method: 'GET', cache: 'no-store' })
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
