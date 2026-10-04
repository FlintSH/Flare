import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'

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
  state.session = null
})
describe('account security HTTP boundary', () => {
  it('rejects bearer authorization even when valid cookies are present', async () => {
    state.session = { user: { id: 'test' } }
    await expect(
      securitySession(
        new Request('https://flare.example/api/auth/security', {
          headers: { authorization: 'Bearer upload-token' },
        }),
        false
      )
    ).rejects.toThrow('browser session')
    expect(state.findUnique).not.toHaveBeenCalled()
  })
  it('rejects signed-out and stale-version sessions', async () => {
    const request = new Request('https://flare.example/api/auth/security')
    await expect(securitySession(request, false)).rejects.toThrow('Sign in')
    state.session = { user: { id: 'test', sessionVersion: 1 } }
    state.findUnique.mockResolvedValue({ id: 'test', sessionVersion: 2 })
    await expect(securitySession(request, false)).rejects.toThrow(
      'Sign in again'
    )
  })
  it('bounds bytes before JSON parsing and requires JSON content type', async () => {
    await expect(
      securityBody(
        new Request('https://flare.example', { method: 'POST', body: '{}' })
      )
    ).rejects.toThrow('application/json')
    await expect(
      securityBody(
        new Request('https://flare.example', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: '🔒'.repeat(17000) }),
        })
      )
    ).rejects.toThrow('too large')
    expect(
      await securityBody(
        new Request('https://flare.example', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"code":"123456"}',
        })
      )
    ).toEqual({ code: '123456' })
  })
  it('never exposes database or provider errors and disables response caching', async () => {
    const response = await securityRoute(async () => {
      throw new Error('secret database connection credentials')
    })
    expect(await response.text()).not.toContain('credentials')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
