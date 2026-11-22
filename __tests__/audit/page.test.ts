import { GET } from '@/app/api/audit/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { auditPage } from '@/lib/audit/page'
import { auditQuerySchema } from '@/lib/audit/query'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'auditor', permissions: ['audit.read'] },
  }),
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

const event = { id: 'event-1', action: 'file.create', category: 'files' }

beforeEach(() => {
  vi.clearAllMocks()
  configureAuditWriter(async () => {})
  mocks.findMany.mockResolvedValue([event])
  mocks.count.mockResolvedValue(0)
  mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
    by[0] === 'category'
      ? [{ category: 'auth' }, { category: 'files' }]
      : [{ action: 'file.create' }]
  )
})

describe('audit page', () => {
  it('counts what it filters, and lists every category and action to filter by', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/audit?category=files&from=2026-01-01T00:00:00Z'
      )
    )
    expect(response.status).toBe(200)
    const where = {
      category: 'files',
      createdAt: { gte: new Date('2026-01-01T00:00:00Z') },
    }
    expect(mocks.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 50,
    })
    expect(mocks.count).toHaveBeenCalledWith({ where })
    // The facets ignore the filters, so a filter can always be changed.
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ['category'],
      orderBy: { category: 'asc' },
      take: 100,
    })
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ['action'],
      orderBy: { action: 'asc' },
      take: 500,
    })
    // An empty log still has one page.
    expect(await response.json()).toEqual({
      events: [event],
      total: 0,
      page: 1,
      limit: 50,
      pages: 1,
      filters: { categories: ['auth', 'files'], actions: ['file.create'] },
    })
  })

  it('answers the same page to a caller that parsed its own filters', async () => {
    mocks.count.mockResolvedValue(101)
    const page = await auditPage(
      auditQuerySchema.parse({ outcome: 'denied', page: '3', limit: '50' })
    )
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { outcome: 'denied' }, skip: 100 })
    )
    expect(page).toEqual({
      events: [event],
      total: 101,
      page: 3,
      limit: 50,
      pages: 3,
      filters: { categories: ['auth', 'files'], actions: ['file.create'] },
    })
  })

  it('words a database failure as unavailable, without its details', async () => {
    mocks.count.mockRejectedValue(new Error('private connection secret'))
    const failure = await auditPage(auditQuerySchema.parse({})).catch(
      (error: unknown) => error
    )
    expect(failure).toMatchObject({
      status: 503,
      message:
        'Unable to load audit events. Check database availability and migrations.',
    })
  })
})
