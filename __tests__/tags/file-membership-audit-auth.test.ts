import { GET } from '@/app/api/files/tags/route'
import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { hashApiToken } from '@/lib/integrations/tokens'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: { findUnique: vi.fn() },
  role: { findUnique: vi.fn() },
  apiToken: { findUnique: vi.fn(), update: vi.fn() },
  queryRaw: vi.fn(),
  emailConfig: vi.fn(),
  error: vi.fn(),
}))

// Real requireAuth, current-role resolution, token scope matching, membership SQL
// and the request audit wrapper run together; external state is disposable.
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: mocks.user,
    role: mocks.role,
    apiToken: mocks.apiToken,
    $queryRaw: mocks.queryRaw,
  },
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: mocks.emailConfig,
  getEmailConfigForUpdate: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: mocks.error } } }))

const events: Prisma.AuditEventCreateManyInput[] = []
const legacySecret = 'fixture-legacy-upload-secret'
const namedSecret = 'flr_fixture-named-secret'
const fileId = 'private-selected-file-id'
const account = {
  id: 'membership-reader',
  name: 'Verified reader name',
  storageUsed: 0,
  urlId: 'reader-url',
  vanityId: null,
  randomizeFileUrls: false,
  email: null,
  emailVerified: null,
  emailVerifiedFor: null,
  emailVerificationSource: null,
  emailExempt: false,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
}
let permissions: string[]

function request(token?: string, ids = fileId) {
  const query = new URLSearchParams({
    fileIds: ids,
    actorId: 'forged-actor-id',
    tokenId: 'forged-token-id',
    password: 'query-password-never-persist',
  })
  return new Request(`https://flare.example/api/files/tags?${query}`, {
    headers: {
      cookie: 'session-cookie-never-persist',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
}

function auditResult(
  status: number,
  outcome: 'success' | 'denied' | 'failure',
  authenticated = true
) {
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    action: 'http.get',
    category: 'requests',
    route: '/api/files/tags',
    method: 'GET',
    status,
    outcome,
    actorName: authenticated ? account.name : 'Anonymous',
    requestId: expect.any(String),
    details: { durationMs: expect.any(Number) },
  })
  expect(events[0].actorId).toBe(authenticated ? account.id : undefined)
  expect(events[0].details).not.toHaveProperty('tokenId')
  const recorded = JSON.stringify(events)
  for (const excluded of [
    legacySecret,
    namedSecret,
    hashApiToken(namedSecret),
    fileId,
    'Private tag name',
    'forged-actor-id',
    'forged-token-id',
    'query-password-never-persist',
    'session-cookie-never-persist',
    'raw-database-error-secret',
  ])
    expect(recorded).not.toContain(excluded)
}

beforeEach(() => {
  vi.clearAllMocks()
  events.length = 0
  permissions = ['files.read']
  configureAuditWriter(async (event) => {
    events.push(event)
  })
  mocks.session.mockResolvedValue({
    user: {
      id: account.id,
      name: 'Stale session name',
      permissions: ['administrator'],
    },
  })
  mocks.user.findUnique.mockImplementation(async () => ({
    ...account,
    roles: [
      {
        id: 'reader-role',
        name: 'Reader',
        description: null,
        color: '#64748b',
        position: 10,
        systemKey: null,
        permissions,
      },
    ],
  }))
  mocks.role.findUnique.mockResolvedValue(null)
  mocks.apiToken.findUnique.mockResolvedValue(null)
  mocks.apiToken.update.mockResolvedValue({})
  mocks.emailConfig.mockResolvedValue({ enabled: false })
  mocks.queryRaw.mockResolvedValue([
    { id: fileId, tags: [{ id: 'private-tag-id', name: 'Private tag name' }] },
  ])
})

describe('tag membership authentication and audit integration', () => {
  it.each(['browser', 'legacy token'])(
    'allows a %s with current files.read and records the verified actor',
    async (method) => {
      if (method === 'legacy token') mocks.session.mockResolvedValue(null)
      const response = await GET(
        request(method === 'legacy token' ? legacySecret : undefined)
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.json()).toMatchObject({
        data: {
          files: [
            {
              id: fileId,
              tags: [{ id: 'private-tag-id', name: 'Private tag name' }],
            },
          ],
        },
      })
      expect(mocks.queryRaw).toHaveBeenCalledOnce()
      expect((mocks.queryRaw.mock.calls[0][0] as Prisma.Sql).values).toEqual([
        account.id,
        account.id,
        fileId,
      ])
      if (method === 'legacy token')
        expect(mocks.user.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { uploadToken: legacySecret },
          })
        )
      auditResult(200, 'success')
    }
  )

  it.each(['files:read', 'files:upload'])(
    'denies a named %s token without falling back to an eligible cookie',
    async (scope) => {
      mocks.apiToken.findUnique.mockResolvedValue({
        id: 'named-token-id',
        user: account,
        scopes: [scope],
        profileId: null,
        revokedAt: null,
        expiresAt: null,
      })
      const response = await GET(request(namedSecret))
      expect(response.status).toBe(401)
      expect(mocks.apiToken.findUnique).toHaveBeenCalledWith({
        where: { hash: hashApiToken(namedSecret) },
        include: { user: true },
      })
      expect(mocks.session).not.toHaveBeenCalled()
      expect(mocks.apiToken.update).not.toHaveBeenCalled()
      expect(mocks.queryRaw).not.toHaveBeenCalled()
      auditResult(401, 'denied', false)
    }
  )

  it.each(['browser', 'legacy token'])(
    'denies a %s after files.read is revoked despite its cached session role',
    async (method) => {
      permissions = ['tags.manage', 'files.update']
      if (method === 'legacy token') mocks.session.mockResolvedValue(null)
      expect(
        (
          await GET(
            request(method === 'legacy token' ? legacySecret : undefined)
          )
        ).status
      ).toBe(403)
      expect(mocks.queryRaw).not.toHaveBeenCalled()
      auditResult(403, 'denied')
    }
  )

  it('audits an anonymous denial without looking up memberships', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
    expect(mocks.user.findUnique).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    auditResult(401, 'denied', false)
  })

  it('audits invalid queries and unavailable selections without returning partial memberships', async () => {
    expect((await GET(request(undefined, ''))).status).toBe(400)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    auditResult(400, 'failure')
    events.length = 0
    mocks.queryRaw.mockResolvedValue([])
    const response = await GET(request())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: 'One or more files are no longer available.',
    })
    auditResult(404, 'failure')
  })

  it('records a failed read without persisting raw database errors', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('raw-database-error-secret'))
    expect((await GET(request())).status).toBe(500)
    auditResult(500, 'failure')
  })
})
