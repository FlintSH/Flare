import { GET } from '@/app/api/audit/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  permissions: ['audit.read'] as string[],
  signedIn: true,
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  auditWrite: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () =>
    mocks.signedIn
      ? { user: { id: 'auditor', permissions: mocks.permissions } }
      : null,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    auditEvent: {
      findMany: mocks.findMany,
      count: mocks.count,
      groupBy: mocks.groupBy,
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  configureAuditWriter(mocks.auditWrite)
  mocks.permissions = ['audit.read']
  mocks.signedIn = true
  mocks.findMany.mockResolvedValue([])
  mocks.count.mockResolvedValue(0)
  mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
    by[0] === 'category' ? [{ category: 'files' }] : [{ action: 'file.create' }]
  )
})

describe('session-only audit endpoint', () => {
  it('rejects unauthenticated requests even with a bearer token before querying events', async () => {
    mocks.signedIn = false
    const response = await GET(
      new Request('http://localhost/api/audit', {
        headers: { Authorization: 'Bearer fixture-token' },
      })
    )
    expect(response.status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'audit.read', outcome: 'denied' })
    )
  })

  it('requires its own sensitive permission and accepts Administrator', async () => {
    mocks.permissions = ['users.read', 'settings.read', 'content.read']
    expect((await GET(new Request('http://localhost/api/audit'))).status).toBe(
      403
    )
    expect(mocks.findMany).not.toHaveBeenCalled()
    mocks.permissions = ['administrator']
    expect((await GET(new Request('http://localhost/api/audit'))).status).toBe(
      200
    )
  })

  it.each([
    '?page=0',
    '?q=one&q=two',
    '?token=secret',
    '?from=invalid',
    '?limit=101',
  ])('rejects invalid/repeated/unknown filters %s', async (query) => {
    expect(
      (await GET(new Request(`http://localhost/api/audit${query}`))).status
    ).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('paginates stably, includes facets, and marks sensitive responses non-cacheable', async () => {
    mocks.count.mockResolvedValue(85)
    const response = await GET(
      new Request(
        'http://localhost/api/audit?page=2&limit=25&q=invoice&outcome=failure&actorId=alex'
      )
    )
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ outcome: 'failure', actorId: 'alex' }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 25,
        take: 25,
      })
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.auditWrite).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      total: 85,
      page: 2,
      limit: 25,
      pages: 4,
      filters: { categories: ['files'], actions: ['file.create'] },
    })
  })

  it('returns a recoverable service error without raw database details', async () => {
    mocks.findMany.mockRejectedValue(new Error('private connection secret'))
    const response = await GET(new Request('http://localhost/api/audit'))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private connection secret')
  })
})
