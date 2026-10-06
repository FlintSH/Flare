import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { auditContext } from './context'
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

export async function recordAudit(input: AuditInput): Promise<void> {
  return recordAuditMany([input])
}

/** Flush all per-object evidence in bounded writes, retaining best-effort behavior. */
export async function recordAuditMany(
  inputs: readonly AuditInput[]
): Promise<void> {
  if (!inputs.length) return
  const context = auditContext.getStore()
  const events = inputs.map((input): AuditInput => ({
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
  }))
  if (context?.pending) {
    for (const event of events) context.pending.push(event)
    return
  }
  try {
    if (!globalAudit.flareAuditWriter) {
      // Auth/workers can be the first module to ask for an audit writer.
      await import('@/lib/database/prisma')
    }
    if (!globalAudit.flareAuditWriter)
      throw new Error('Audit writer unavailable')
  } catch (error) {
    reportAuditFailure(error)
    return
  }
  const write = globalAudit.flareAuditWriter
  const writeMany = globalAudit.flareAuditBatchWriter
  for (let offset = 0; offset < events.length; offset += AUDIT_BATCH_SIZE) {
    try {
      const data = events
        .slice(offset, offset + AUDIT_BATCH_SIZE)
        .map((event) => ({
          action: auditText(event.action, 150) ?? 'unknown',
          category: auditText(event.category, 80) ?? 'system',
          outcome: event.outcome ?? 'success',
          actorId: auditText(event.actorId, 200),
          actorName: auditText(event.actorName),
          targetType: auditText(event.targetType, 80),
          targetId: auditText(event.targetId, 200),
          targetName: auditText(event.targetName, 500),
          requestId: auditText(event.requestId, 100),
          method: auditText(event.method, 12),
          route: auditText(event.route, 300),
          status: event.status,
          details: sanitizeAuditDetails(event.details) as Prisma.InputJsonValue,
        }))
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

/** Route templates only. Actual IDs and names belong in explicit target fields. */
export function auditRoutePath(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const known = new Set([
    'api',
    'auth',
    'login',
    'logout',
    'register',
    'callback',
    'signin',
    'signout',
    'session',
    'csrf',
    'providers',
    'credentials',
    'oidc',
    'passkeys',
    'options',
    'verify',
    'authenticate',
    'registration',
    'recovery',
    'codes',
    'totp',
    'profile',
    'users',
    'roles',
    'settings',
    'appearance',
    'assets',
    'avatar',
    'files',
    'upload',
    'paste',
    'download',
    'raw',
    'thumbnail',
    'ocr',
    'tags',
    'folders',
    'share',
    'unshare',
    'urls',
    'shorten',
    'tokens',
    'webhooks',
    'deliveries',
    'test',
    'retry',
    'export',
    'email',
    'verification',
    'resend',
    'confirm',
    'change',
    'password',
    'reset',
    'forgot',
    'sessions',
    'history',
    'security',
    'setup',
    'config',
    'upload-profiles',
    'preferences',
    'f',
    's',
  ])
  return (
    '/' +
    segments.map((segment) => (known.has(segment) ? segment : ':id')).join('/')
  )
}

export function withAuditRoute<Args extends unknown[], Result extends Response>(
  handler: (...args: Args) => Promise<Result>,
  options: {
    action?: string
    category?: string
    route?: string
    skipSuccess?: boolean
  } = {}
): (...args: Args extends [] ? [request?: Request] : Args) => Promise<Result> {
  return async (...args) => {
    const request = args[0] instanceof Request ? args[0] : undefined
    const route =
      options.route ?? (request ? auditRoutePath(request.url) : undefined)
    const method = request?.method ?? 'GET'
    const started = Date.now()
    return auditContext.run(
      { requestId: randomUUID(), method, route },
      async () => {
        try {
          const response = await handler(...(args as Args))
          const outcome =
            auditContext.getStore()?.outcome ??
            (response.status === 401 || response.status === 403
              ? 'denied'
              : response.status >= 400
                ? 'failure'
                : 'success')
          if (options.skipSuccess && outcome === 'success') return response
          await recordAudit({
            action: options.action ?? `http.${method.toLowerCase()}`,
            category: options.category ?? 'requests',
            outcome,
            status: response.status,
            details: { durationMs: Date.now() - started },
          })
          return response
        } catch (error) {
          await recordAudit({
            action: options.action ?? `http.${method.toLowerCase()}`,
            category: options.category ?? 'requests',
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
}
