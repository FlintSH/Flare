export type AuditOutcome = 'success' | 'failure' | 'denied'

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

export interface AuditEventView {
  id: string
  createdAt: string
  action: string
  category: string
  outcome: AuditOutcome
  actorId: string | null
  actorName: string | null
  targetType: string | null
  targetId: string | null
  targetName: string | null
  requestId: string | null
  method: string | null
  route: string | null
  status: number | null
  details: Record<string, unknown>
}
