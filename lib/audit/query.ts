import type { Prisma } from '@prisma/client'
import { z } from 'zod'

const filter = z.string().trim().max(200).optional()
export const auditQuerySchema = z
  .object({
    q: filter,
    category: filter,
    action: filter,
    outcome: z.enum(['success', 'failure', 'denied']).optional(),
    actorId: filter,
    targetId: filter,
    requestId: filter,
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    (value) =>
      !value.from || !value.to || new Date(value.from) <= new Date(value.to),
    {
      message: 'From must be before or equal to To',
      path: ['from'],
    }
  )

export function auditWhere(
  filters: z.infer<typeof auditQuerySchema>
): Prisma.AuditEventWhereInput {
  return {
    ...(filters.q
      ? {
          OR: [
            'action',
            'actorName',
            'targetName',
            'targetId',
            'requestId',
          ].map((key) => ({
            [key]: { contains: filters.q, mode: 'insensitive' },
          })),
        }
      : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.targetId ? { targetId: filters.targetId } : {}),
    ...(filters.requestId ? { requestId: filters.requestId } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          },
        }
      : {}),
  }
}
