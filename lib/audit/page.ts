import type { AuditEvent } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { unavailable } from '@/lib/http/errors'

import { type AuditQuery, auditWhere } from './query'
import type { AuditPage } from './types'

export const AUDIT_UNAVAILABLE =
  'Unable to load audit events. Check database availability and migrations.'

/**
 * One page of audit events matching the filters, newest first, with every
 * category and action there is to filter by.
 */
export async function auditPage(
  filters: AuditQuery
): Promise<AuditPage<AuditEvent>> {
  const { page, limit } = filters
  const where = auditWhere(filters)
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
  ]).catch(unavailable(AUDIT_UNAVAILABLE))
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
}
