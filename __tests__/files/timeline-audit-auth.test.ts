import { GET } from '@/app/api/files/timeline/route'
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

// Keep the real requireAuth, permission resolver, token scope matcher, timeline
// service and audit wrapper together. Only their external dependencies are fake.
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
const secret = 'flr_fixture-secret-never-persist'
const search = 'private searched OCR phrase'
let permissions: string[]
const account = {
  id: 'timeline-reader',
  name: 'Current reader name',
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

function request(token?: string) {
  const query = new URLSearchParams({
    search,
    ids: 'private-selected-file-id',
    actorId: 'forged-query-actor',
    tokenId: 'forged-query-token',
    password: 'query-password-never-persist',
  })
  return new Request(`https://flare.example/api/files/timeline?${query}`, {
    headers: {
      cookie: 'fixture-session-cookie-never-persist',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
}

function namedToken(scopes: string[]) {
  mocks.apiToken.findUnique.mockResolvedValue({
    id: 'named-read-token-id',
    hash: hashApiToken(secret),
    scopes,
    user: account,
    profileId: null,
    revokedAt: null,
    expiresAt: null,
  })
}

function auditResult(status: number, outcome: 'success' | 'denied') {
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    action: 'http.get',
    category: 'requests',
    route: '/api/files/timeline',
    method: 'GET',
    status,
    outcome,
    requestId: expect.any(String),
    details: { durationMs: expect.any(Number) },
  })
  const recorded = JSON.stringify(events)
  for (const excluded of [
    secret,
    hashApiToken(secret),
    search,
    'private-selected-file-id',
    'forged-query-actor',
    'forged-query-token',
    'query-password-never-persist',
    'fixture-session-cookie-never-persist',
  ])
    expect(recorded).not.toContain(excluded)
  return events[0]
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
  mocks.queryRaw.mockImplementation(async (query: Prisma.Sql) =>
    query.sql.includes('clock_timestamp')
      ? [{ snapshot: new Date('2026-10-06T12:00:00.000Z') }]
      : [
          {
            from: new Date('2025-01-01T00:00:00.000Z'),
            to: new Date('2025-02-01T00:00:00.000Z'),
            count: 2n,
          },
        ]
  )
})

describe('timeline authentication and audit integration', () => {
  it('binds a browser request to the current account and keeps query contents out of audit records', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect((await response.json()).data.total).toBe(2)
    expect(mocks.session).toHaveBeenCalledOnce()
    expect(mocks.apiToken.findUnique).not.toHaveBeenCalled()
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2)
    const aggregate = mocks.queryRaw.mock.calls[1][0] as Prisma.Sql
    expect(aggregate.values).toContain(account.id)
    expect(aggregate.values).toContain(`%${search}%`)
    expect(auditResult(200, 'success')).toMatchObject({
      actorId: account.id,
      actorName: account.name,
    })
    expect(events[0].details).not.toHaveProperty('tokenId')
  })

  it('uses a named read token independently of cookies and records only its database ID', async () => {
    namedToken(['files:read'])
    const response = await GET(request(secret))
    expect(response.status).toBe(200)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.apiToken.findUnique).toHaveBeenCalledWith({
      where: { hash: hashApiToken(secret) },
      include: { user: true },
    })
    expect(mocks.apiToken.update).toHaveBeenCalledWith({
      where: { id: 'named-read-token-id' },
      data: { lastUsedAt: expect.any(Date) },
    })
    expect(auditResult(200, 'success')).toMatchObject({
      actorId: account.id,
      actorName: account.name,
      details: { tokenId: 'named-read-token-id' },
    })
  })

  it('denies an upload-only token without falling back to an eligible browser session', async () => {
    namedToken(['files:upload'])
    const response = await GET(request(secret))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.apiToken.update).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    const event = auditResult(401, 'denied')
    expect(event.actorId).toBeUndefined()
    expect(event.actorName).toBe('Anonymous')
    expect(event.details).not.toHaveProperty('tokenId')
  })

  it.each(['browser', 'named token'])(
    'denies revoked files.read permission for a %s while preserving the verified actor',
    async (method) => {
      permissions = ['files.upload']
      if (method === 'named token') namedToken(['files:read'])
      const response = await GET(
        request(method === 'named token' ? secret : undefined)
      )
      expect(response.status).toBe(403)
      expect(mocks.queryRaw).not.toHaveBeenCalled()
      const event = auditResult(403, 'denied')
      expect(event).toMatchObject({
        actorId: account.id,
        actorName: account.name,
      })
      if (method === 'named token')
        expect(event.details).toHaveProperty('tokenId', 'named-read-token-id')
      else expect(event.details).not.toHaveProperty('tokenId')
    }
  )

  it('denies a missing or revoked browser session before accessing library metadata', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.user.findUnique).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(auditResult(401, 'denied').actorName).toBe('Anonymous')
  })
})
