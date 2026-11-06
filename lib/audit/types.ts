import type { AuditEvent } from '@prisma/client'

export const AUDIT_OUTCOMES = ['success', 'failure', 'denied'] as const
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

export interface AuditInput {
  action: string
  category: string
  outcome?: AuditOutcome
  actorId?: string | null
  actorName?: string | null
  targetType?: string | null
  targetId?: string | null
  targetName?: string | null
  requestId?: string | null
  method?: string | null
  route?: string | null
  status?: number | null
  details?: Record<string, unknown>
}

/** An audit event as `GET /api/audit` sends it. */
export type AuditEventView = Omit<
  AuditEvent,
  'createdAt' | 'outcome' | 'details'
> & {
  createdAt: string
  outcome: AuditOutcome
  details: Record<string, unknown>
}

/** One page of `GET /api/audit`, with the categories and actions to filter by. */
export interface AuditPage<Event = AuditEventView> {
  events: Event[]
  total: number
  page: number
  limit: number
  pages: number
  filters: { categories: string[]; actions: string[] }
}
