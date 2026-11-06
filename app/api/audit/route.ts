import { auditQuerySchema, auditWhere } from '@/lib/audit/query'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'

const api = routes('/api/audit', {
  headers: { 'Cache-Control': 'private, no-store' },
  failure: {
    status: 503,
    message:
      'Unable to load audit events. Check database availability and migrations.',
  },
})

export const GET = api(
  async (request) => {
    await requireSession('audit.read')
    const parameters = new URL(request.url).searchParams
    const parsed = auditQuerySchema.safeParse(Object.fromEntries(parameters))
    if (
      !parsed.success ||
      [...parameters.keys()].some((key) => parameters.getAll(key).length > 1)
    )
      throw new HttpError(
        400,
        'Invalid audit filters. Use bounded page/limit values and ISO timestamps with a timezone.'
      )
    const { page, limit } = parsed.data
    const where = auditWhere(parsed.data)
    const [events, total, categories, actions] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.groupBy({
        by: ['category'],
        orderBy: { category: 'asc' },
        take: 100,
      }),
      prisma.auditEvent.groupBy({
        by: ['action'],
        orderBy: { action: 'asc' },
        take: 500,
      }),
    ])
    return {
      events,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      filters: {
        categories: categories.map((item) => item.category),
        actions: actions.map((item) => item.action),
      },
    }
  },
  { audit: { action: 'audit.read', category: 'audit', skipSuccess: true } }
)
