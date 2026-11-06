import { NextResponse } from 'next/server'

import { POST as passkeyOptions } from '@/app/api/auth/passkeys/options/route'
import { POST as enableTotp } from '@/app/api/auth/security/totp/enable/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  enableTotp: vi.fn(),
}))
vi.mock('@/lib/audit', async (original) => ({
  ...(await original<object>()),
  auditRequest: (
    _request: Request,
    _options: unknown,
    handle: () => Promise<Response>
  ) => handle(),
}))
vi.mock('@/lib/auth/security/shared', async (original) => ({
  ...(await original<object>()),
  securityLimit: vi.fn(),
}))
vi.mock('@/lib/auth/security/passkeys', async (original) => ({
  ...(await original<object>()),
  authenticationOptions: mocks.options,
}))
vi.mock('@/lib/auth/security/http', async (original) => ({
  ...(await original<object>()),
  securitySession: async () => ({ session: { user: { id: 'account' } } }),
}))
vi.mock('@/lib/auth/security/service', async (original) => ({
  ...(await original<object>()),
  enableTotp: mocks.enableTotp,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.options.mockResolvedValue({
    options: { challenge: 'public-challenge' },
    challengeId: 'challenge-id',
    binding: 'browser-binding',
  })
  mocks.enableTotp.mockResolvedValue({ signInAgain: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('passkey sign-in options', () => {
  it.each(['https://flare.example', 'http://localhost:3000'])(
    'sets the same challenge cookie as before on %s',
    async (origin) => {
      vi.stubEnv('NEXTAUTH_URL', origin)
      const response = await passkeyOptions(
        new Request(`${origin}/api/auth/passkeys/options`, {
          method: 'POST',
          headers: { origin },
        })
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        options: { challenge: 'public-challenge' },
        challengeId: 'challenge-id',
      })
      // What the route set before the cookie had one owner.
      const secure = origin.startsWith('https:')
      const before = NextResponse.json({})
      before.cookies.set(
        secure ? '__Host-flare-passkey-challenge' : 'flare-passkey-challenge',
        'browser-binding',
        { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: 300 }
      )
      expect(response.headers.get('set-cookie')).toBe(
        before.headers.get('set-cookie')
      )
    }
  )
})

describe('authenticator setup confirmation', () => {
  function confirm(code: unknown) {
    return enableTotp(
      new Request('https://flare.example/api/auth/security/totp/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, challengeId: 'c'.repeat(20) }),
      })
    )
  }

  it('takes a six-digit code', async () => {
    expect((await confirm('123456')).status).toBe(200)
    expect(mocks.enableTotp).toHaveBeenCalledWith(
      { user: { id: 'account' } },
      '123456',
      'c'.repeat(20)
    )
  })

  it.each(['12345', '1234567', '12345a', 123456])(
    'refuses %s as before',
    async (code) => {
      const response = await confirm(code)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'Invalid security request.',
      })
      expect(mocks.enableTotp).not.toHaveBeenCalled()
    }
  )
})
