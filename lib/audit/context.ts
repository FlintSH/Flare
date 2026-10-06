import { AsyncLocalStorage } from 'node:async_hooks'

import type { AuditInput, AuditOutcome } from './types'

export interface AuditContext {
  requestId?: string
  method?: string
  route?: string
  actorId?: string | null
  actorName?: string | null
  tokenId?: string
  targetType?: string
  targetId?: string
  targetName?: string
  pending?: AuditInput[]
  transactionClient?: unknown
  outcome?: AuditOutcome
}

const globalAudit = globalThis as typeof globalThis & {
  flareAuditContext?: AsyncLocalStorage<AuditContext>
}
export const auditContext = (globalAudit.flareAuditContext ??=
  new AsyncLocalStorage<AuditContext>())

/** Called only after authenticating the identity, never from request parameters. */
export function setAuditActor(actor: {
  id: string
  name?: string | null
  tokenId?: string
}) {
  const context = auditContext.getStore()
  if (context) {
    context.actorId = actor.id
    context.actorName = actor.name ?? actor.id
    context.tokenId = actor.tokenId
  }
}

export function setAuditTarget(target: {
  type: string
  id?: string
  name?: string
}) {
  const context = auditContext.getStore()
  if (context) {
    context.targetType = target.type
    context.targetId = target.id
    context.targetName = target.name
  }
}

/** Preserve a security denial even when the HTTP response deliberately masks it as 404. */
export function setAuditOutcome(outcome: AuditOutcome) {
  const context = auditContext.getStore()
  if (context) context.outcome = outcome
}
