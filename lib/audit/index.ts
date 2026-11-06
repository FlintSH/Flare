import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { auditContext } from './context'
import { auditedModels } from './models'
import { auditText, sanitizeAuditDetails } from './sanitize'
import type { AuditInput } from './types'

export { setAuditActor, setAuditTarget, setAuditOutcome } from './context'
export type { AuditInput, AuditOutcome } from './types'

type AuditWriter = (data: Prisma.AuditEventCreateManyInput) => Promise<unknown>
type AuditBatchWriter = (
  data: Prisma.AuditEventCreateManyInput[]
) => Promise<unknown>
const AUDIT_BATCH_SIZE = 500
const globalAudit = globalThis as typeof globalThis & {
  flareAuditWriter?: AuditWriter
  flareAuditBatchWriter?: AuditBatchWriter
}

/** The base Prisma client is injected to avoid recursive audit interception. */
export function configureAuditWriter(
  write: AuditWriter,
  writeMany?: AuditBatchWriter
) {
  globalAudit.flareAuditWriter = write
  globalAudit.flareAuditBatchWriter = writeMany
}

function reportAuditFailure(error: unknown) {
  // Never include input or raw database errors: either may contain secrets.
  const kind =
    error instanceof Error && /^[A-Za-z0-9_]{1,80}$/.test(error.name)
      ? error.name
      : 'UnknownError'
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,20}$/.test(error.code)
      ? error.code
      : 'unknown'
  console.error(
    `[audit] Failed to persist an audit event (${kind}, ${code}); check database availability and migrations`
  )
}

const textLimits = {
  action: 150,
  category: 80,
  actorId: 200,
  actorName: 300,
  targetType: 80,
  targetId: 200,
  targetName: 500,
  requestId: 100,
  method: 12,
  route: 300,
}

function inRequest(input: AuditInput): AuditInput {
  const context = auditContext.getStore()
  return {
    requestId: context?.requestId,
    method: context?.method,
    route: context?.route,
    actorId: context?.actorId,
    actorName:
      context?.actorName ?? (context?.requestId ? 'Anonymous' : 'System'),
    targetType: context?.targetType,
    targetId: context?.targetId,
    targetName: context?.targetName,
    ...input,
    details: {
      // Capture absence too: a later flush must not inherit another token's identity.
      tokenId: context?.tokenId,
      ...input.details,
    },
  }
}

function auditRow(event: AuditInput): Prisma.AuditEventCreateManyInput {
  return {
    action: auditText(event.action, textLimits.action) ?? 'unknown',
    category: auditText(event.category, textLimits.category) ?? 'system',
    outcome: event.outcome ?? 'success',
    actorId: auditText(event.actorId, textLimits.actorId),
    actorName: auditText(event.actorName, textLimits.actorName),
    targetType: auditText(event.targetType, textLimits.targetType),
    targetId: auditText(event.targetId, textLimits.targetId),
    targetName: auditText(event.targetName, textLimits.targetName),
    requestId: auditText(event.requestId, textLimits.requestId),
    method: auditText(event.method, textLimits.method),
    route: auditText(event.route, textLimits.route),
    status: event.status,
    details: sanitizeAuditDetails(event.details) as Prisma.InputJsonValue,
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  return recordAuditMany([input])
}

/** Flush all per-object evidence in bounded writes, retaining best-effort behavior. */
export async function recordAuditMany(
  inputs: readonly AuditInput[]
): Promise<void> {
  if (!inputs.length) return
  const context = auditContext.getStore()
  const events = inputs.map(inRequest)
  if (context?.pending) {
    for (const event of events) context.pending.push(event)
    return
  }
  const write = globalAudit.flareAuditWriter
  const writeMany = globalAudit.flareAuditBatchWriter
  if (!write) {
    reportAuditFailure(new Error('Audit writer unavailable'))
    return
  }
  for (let offset = 0; offset < events.length; offset += AUDIT_BATCH_SIZE) {
    try {
      const data = events.slice(offset, offset + AUDIT_BATCH_SIZE).map(auditRow)
      if (writeMany && events.length > 1) await writeMany(data)
      else
        for (const event of data) {
          try {
            await write(event)
          } catch (error) {
            reportAuditFailure(error)
          }
        }
    } catch (error) {
      reportAuditFailure(error)
    }
  }
}

/**
 * Records a delete event for each `model` row matching `where`, for rows a
 * database cascade is about to remove, which the Prisma audit extension never
 * sees. It is one INSERT ... SELECT in the caller's transaction, so the events
 * commit with the deletion and no row is read into memory. The action,
 * category and target type come from `auditedModels`; `name` is the column
 * naming each row, and `copy` maps detail keys to columns. Every column must
 * be one of the model's audited fields.
 */
export async function recordCascadedDeletes(
  tx: Prisma.TransactionClient,
  model: 'File' | 'Invite',
  {
    where,
    name,
    copy,
    ...event
  }: {
    where: Record<string, string>
    name: string
    copy: Record<string, string>
    actorId: string
    actorName: string
    reason: string
  }
) {
  const { target, category, fields, keys } = auditedModels[model]!
  const column = (field: string) => {
    if (!fields.includes(field))
      throw new Error(`${model}.${field} is not an audited field`)
    return Prisma.raw(`"${field}"`)
  }
  const row = auditRow(
    inRequest({
      action: `${target}.delete`,
      category,
      targetType: target,
      actorId: event.actorId,
      actorName: event.actorName,
      details: { reason: event.reason },
    })
  )
  const copied = Object.entries(copy).map(
    ([detail, field]) => Prisma.sql`${detail}::text, ${column(field)}`
  )
  await tx.$executeRaw`
    INSERT INTO "AuditEvent"
      (id, action, category, outcome, "actorId", "actorName", "targetType",
       "targetId", "targetName", "requestId", method, route, details)
    SELECT gen_random_uuid()::text, ${row.action}, ${row.category},
      ${row.outcome}, ${row.actorId ?? null}, ${row.actorName ?? null},
      ${row.targetType ?? null},
      LEFT(${column(keys?.[0] ?? 'id')}, ${textLimits.targetId}::int),
      NULLIF(LEFT(${column(name)}, ${textLimits.targetName}::int), ''),
      ${row.requestId ?? null}, ${row.method ?? null}, ${row.route ?? null},
      ${JSON.stringify(row.details)}::jsonb ||
        ${copied.length ? Prisma.sql`jsonb_build_object(${Prisma.join(copied)})` : Prisma.sql`'{}'::jsonb`}
    FROM ${Prisma.raw(`"${model}"`)}
    WHERE ${Prisma.join(
      Object.entries(where).map(
        ([field, value]) => Prisma.sql`${column(field)} = ${value}`
      ),
      ' AND '
    )}
  `
}

/**
 * Record one HTTP request under its route template (never the actual path:
 * IDs and names belong in explicit target fields), with the actor and target
 * the handler sets, the outcome and the duration.
 */
export async function auditRequest(
  request: Request,
  options: {
    route: string
    action?: string
    category?: string
    skipSuccess?: boolean
  },
  handle: () => Promise<Response>
): Promise<Response> {
  const method = request.method
  const started = Date.now()
  const action = options.action ?? `http.${method.toLowerCase()}`
  const category = options.category ?? 'requests'
  return auditContext.run(
    { requestId: randomUUID(), method, route: options.route },
    async () => {
      try {
        const response = await handle()
        const outcome =
          auditContext.getStore()?.outcome ??
          (response.status === 401 || response.status === 403
            ? 'denied'
            : response.status >= 400
              ? 'failure'
              : 'success')
        if (options.skipSuccess && outcome === 'success') return response
        await recordAudit({
          action,
          category,
          outcome,
          status: response.status,
          details: { durationMs: Date.now() - started },
        })
        return response
      } catch (error) {
        await recordAudit({
          action,
          category,
          outcome: 'failure',
          status: 500,
          details: {
            durationMs: Date.now() - started,
            reason: 'Unhandled request error',
          },
        })
        throw error
      }
    }
  )
}
