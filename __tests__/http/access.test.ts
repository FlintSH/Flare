import { POST as scheduleExpiry } from '@/app/api/files/[id]/expiry/route'
import { POST as completeChunks } from '@/app/api/files/chunks/[uploadId]/complete/route'
import { POST as startChunks } from '@/app/api/files/chunks/route'
import { POST as upload } from '@/app/api/files/route'
import { POST as shorten } from '@/app/api/urls/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  refuseApiCredentials,
  requireAccount,
  requireSession,
} from '@/lib/http/access'
import { readJson } from '@/lib/http/request'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  accessSession: vi.fn(),
  anySession: vi.fn(),
  findUser: vi.fn(),
}))
vi.mock('@/lib/auth/api-auth', () => ({
  getAuthenticatedUser: mocks.account,
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.accessSession,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.anySession }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}))

const site = 'https://flare.test'
const signedIn = {
  id: 'owner',
  permissions: ['administrator'],
  credential: 'session',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXTAUTH_URL', site)
  mocks.account.mockResolvedValue(signedIn)
})
afterEach(() => vi.unstubAllEnvs())

let address = 0
/** Each request comes from its own address, so no rate limit is reached. */
function post(path: string, headers: Record<string, string>, body = '{}') {
  return new Request(site + path, {
    method: 'POST',
    headers: { 'x-real-ip': `198.51.100.${++address % 250}`, ...headers },
    body,
  })
}

const sessionWrites = [
  ['POST /api/files', (request: Request) => upload(request)],
  ['POST /api/files/chunks', (request: Request) => startChunks(request)],
  [
    'POST /api/files/chunks/{id}/complete',
    (request: Request) =>
      completeChunks(request, {
        params: Promise.resolve({ uploadId: 'upload' }),
      }),
  ],
  [
    'POST /api/files/{id}/expiry',
    (request: Request) =>
      scheduleExpiry(request, { params: Promise.resolve({ id: 'file' }) }),
  ],
  ['POST /api/urls', (request: Request) => shorten(request)],
] as const

describe('writes the browser session authenticates', () => {
  it.each(sessionWrites)(
    '%s refuses other origins, including sibling subdomains',
    async (route, handle) => {
      const path = route.split(' ')[1].replace(/\{id\}/, 'upload')
      for (const headers of [
        { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
        { Origin: 'https://other.flare.test', 'Sec-Fetch-Site': 'same-site' },
      ]) {
        const response = await handle(
          post(path, { ...headers, 'Content-Type': 'text/plain' })
        )
        expect(response.status).toBe(403)
        expect((await response.json()).error).toBe(
          'Cross-origin requests are not allowed.'
        )
      }
    }
  )

  it.each(sessionWrites.slice(1, 5))(
    '%s refuses a body that is not JSON',
    async (route, handle) => {
      const path = route.split(' ')[1].replace(/\{id\}/, 'upload')
      for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
        const response = await handle(
          post(path, { Origin: site, 'Content-Type': type })
        )
        expect(response.status).toBe(415)
        expect((await response.json()).error).toBe('Use application/json.')
      }
    }
  )

  it('leaves token requests to the route, whatever their origin and body type', async () => {
    mocks.account.mockResolvedValue({ ...signedIn, credential: 'token' })
    const response = await shorten(
      post(
        '/api/urls',
        { Origin: 'https://attacker.example', 'Content-Type': 'text/plain' },
        '{'
      )
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Invalid JSON.',
    })
  })
})

describe('requireAccount', () => {
  it('refuses a session write from another origin after checking permissions', async () => {
    mocks.account.mockResolvedValue({ ...signedIn, permissions: [] })
    const write = post('/api/urls', { Origin: 'https://attacker.example' })
    await expect(requireAccount(write)).rejects.toMatchObject({
      status: 403,
      message: 'You do not have permission to perform this action.',
    })
  })

  it('reports the credential and checks only browser-session writes', async () => {
    for (const credential of ['token', 'upload-token']) {
      mocks.account.mockResolvedValue({ ...signedIn, credential })
      const write = post('/api/urls', {
        Origin: 'https://attacker.example',
        'Content-Type': 'text/plain',
      })
      expect((await requireAccount(write)).credential).toBe(credential)
      expect(await readJson(write)).toEqual({})
    }
  })
})

describe('requireSession', () => {
  const session = { user: { id: 'owner', permissions: [], sessionVersion: 3 } }

  it('reads the restricted session only when pending email is allowed', async () => {
    mocks.anySession.mockResolvedValue(session)
    const read = new Request(`${site}/api/auth/email/status`)
    await expect(requireSession(read)).rejects.toMatchObject({
      status: 401,
      message: 'Authentication required',
    })
    expect(
      (await requireSession(read, undefined, { pendingEmail: true })).user.id
    ).toBe('owner')
  })

  it('reads the account row and refuses a session that ended since', async () => {
    mocks.accessSession.mockResolvedValue(session)
    const read = new Request(`${site}/api/files/archive`)
    mocks.findUser.mockResolvedValue({ id: 'owner', sessionVersion: 3 })
    expect(
      (await requireSession(read, undefined, { fresh: true })).account
    ).toEqual({ id: 'owner', sessionVersion: 3 })
    for (const row of [null, { id: 'owner', sessionVersion: 4 }]) {
      mocks.findUser.mockResolvedValue(row)
      await expect(
        requireSession(read, undefined, { fresh: true })
      ).rejects.toMatchObject({
        status: 401,
        message: 'Sign in again to continue.',
      })
    }
  })

  it('refuses API credentials before reading the session when asked to', async () => {
    mocks.accessSession.mockResolvedValue(session)
    const withToken = new Request(`${site}/api/files/archive`, {
      headers: { Authorization: 'Bearer flr_token' },
    })
    expect((await requireSession(withToken)).user.id).toBe('owner')
    await expect(
      requireSession(withToken, undefined, { refuseApiCredentials: true })
    ).rejects.toMatchObject({
      status: 401,
      message: 'API credentials cannot authorize this request.',
    })
    expect(() => refuseApiCredentials(withToken)).toThrow(
      'API credentials cannot authorize this request.'
    )
  })

  it('requires any one of several permissions, then the origin of writes', async () => {
    mocks.accessSession.mockResolvedValue({
      user: { id: 'owner', permissions: ['invites.manage'] },
    })
    const write = post('/api/invites/invite', {
      Origin: 'https://attacker.example',
    })
    await expect(requireSession(write, 'invites.create')).rejects.toMatchObject(
      { status: 403, message: 'Permission denied' }
    )
    await expect(
      requireSession(write, ['invites.create', 'invites.manage'])
    ).rejects.toMatchObject({
      status: 403,
      message: 'Cross-origin requests are not allowed.',
    })
  })
})
