import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SECURITY_BODY_LIMIT,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const state = vi.hoisted(() => ({
  session: null as unknown,
  findUnique: vi.fn(),
  raw: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: () => state.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findUnique: state.findUnique }, $queryRaw: state.raw },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  state.session = null
})
describe('account security HTTP boundary', () => {
  it('rejects bearer authorization even when valid cookies are present', async () => {
    state.session = { user: { id: 'test' } }
    await expect(
      securitySession(
        new Request('https://flare.example/api/auth/security', {
          headers: { authorization: 'Bearer upload-token' },
        })
      )
    ).rejects.toMatchObject({
      status: 401,
      message: 'API credentials cannot authorize this request.',
    })
    expect(state.findUnique).not.toHaveBeenCalled()
  })
  it('rejects signed-out and stale-version sessions', async () => {
    const request = new Request('https://flare.example/api/auth/security')
    await expect(securitySession(request)).rejects.toMatchObject({
      status: 401,
      message: 'Authentication required',
    })
    state.session = { user: { id: 'test', sessionVersion: 1 } }
    state.findUnique.mockResolvedValue({ id: 'test', sessionVersion: 2 })
    await expect(securitySession(request)).rejects.toMatchObject({
      status: 401,
      message: 'Sign in again to continue.',
    })
  })
  it('accepts the request origin or the public origin, and no other', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
    state.session = { user: { id: 'test', sessionVersion: 1 } }
    state.findUnique.mockResolvedValue({ id: 'test', sessionVersion: 1 })
    state.raw.mockResolvedValue([{ count: 1, resetsIn: 900 }])
    const write = (url: string, origin: string) =>
      securitySession(new Request(url, { method: 'POST', headers: { origin } }))
    await expect(
      write('https://flare.example/api/auth/security', 'https://flare.example')
    ).resolves.toMatchObject({ user: { id: 'test' } })
    await expect(
      write('http://internal:3000/api/auth/security', 'https://flare.example')
    ).resolves.toMatchObject({ user: { id: 'test' } })
    await expect(
      write('https://flare.example/api/auth/security', 'https://other.example')
    ).rejects.toMatchObject({
      status: 403,
      message: 'Cross-origin requests are not allowed.',
    })
  })
  it('bounds bytes before JSON parsing and requires JSON content type', async () => {
    state.session = { user: { id: 'test', sessionVersion: 1 } }
    state.findUnique.mockResolvedValue({ id: 'test', sessionVersion: 1 })
    state.raw.mockResolvedValue([{ count: 1, resetsIn: 900 }])
    const body = async (init: RequestInit) => {
      const request = new Request('https://flare.example/api/auth/security', {
        method: 'POST',
        ...init,
      })
      await securitySession(request)
      return readJson(request, { limit: SECURITY_BODY_LIMIT })
    }
    await expect(body({ body: '{}' })).rejects.toMatchObject({
      status: 415,
      message: 'Use application/json.',
    })
    await expect(
      body({
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: '🔒'.repeat(17000) }),
      })
    ).rejects.toMatchObject({ status: 413 })
    expect(
      await body({
        headers: { 'content-type': 'application/json' },
        body: '{"code":"123456"}',
      })
    ).toEqual({ code: '123456' })
  })
  it('refuses throttled mutations for the whole 15-minute window', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://flare.example')
    state.session = { user: { id: 'test', sessionVersion: 1 } }
    state.findUnique.mockResolvedValue({ id: 'test', sessionVersion: 1 })
    state.raw.mockResolvedValue([{ count: 21, resetsIn: 42 }])
    const response = await routes(
      '/api/auth/security',
      securityRoutes
    )(() =>
      securitySession(
        new Request('https://flare.example/api/auth/security', {
          method: 'POST',
          headers: { origin: 'https://flare.example' },
        })
      )
    )(new Request('https://flare.example/api/auth/security'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    expect(await response.json()).toEqual({
      error: 'Too many security attempts. Try again in 15 minutes.',
    })
    const values = state.raw.mock.calls[0].slice(1)
    expect(values).toContain(
      createHash('sha256').update('auth:management:test').digest('hex')
    )
    expect(values).toContain(900)
  })
  it('never exposes database or provider errors and disables response caching', async () => {
    const response = await routes(
      '/api/auth/security',
      securityRoutes
    )(async () => {
      throw new Error('secret database connection credentials')
    })(new Request('https://flare.example/api/auth/security'))
    expect(await response.text()).not.toContain('credentials')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
