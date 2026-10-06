import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { auditQuerySchema, auditWhere } from '@/lib/audit/query'
import { prisma } from '@/lib/database/prisma'
import { requirePermission } from '@/lib/permissions/server'

export async function GET(request: Request) {
  return withAuditRoute(
    async () => {
      const { response } = await requirePermission('audit.read')
      if (response) return response
      const parameters = new URL(request.url).searchParams
      const parsed = auditQuerySchema.safeParse(Object.fromEntries(parameters))
      if (
        !parsed.success ||
        [...parameters.keys()].some((key) => parameters.getAll(key).length > 1)
      ) {
        return NextResponse.json(
          {
            error:
              'Invalid audit filters. Use bounded page/limit values and ISO timestamps with a timezone.',
          },
          { status: 400 }
        )
      }
      const { page, limit } = parsed.data
      const where = auditWhere(parsed.data)
      try {
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
        return NextResponse.json(
          {
            events,
            total,
            page,
            limit,
            pages: Math.max(1, Math.ceil(total / limit)),
            filters: {
              categories: categories.map((item) => item.category),
              actions: actions.map((item) => item.action),
            },
          },
          { headers: { 'Cache-Control': 'private, no-store' } }
        )
      } catch {
        return NextResponse.json(
          {
            error:
              'Unable to load audit events. Check database availability and migrations.',
          },
          { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
        )
      }
    },
    {
      route: '/api/audit',
      action: 'audit.read',
      category: 'audit',
      skipSuccess: true,
    }
  )(request)
}
