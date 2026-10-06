import { Prisma, type PrismaClient } from '@prisma/client'

import { auditContext } from './context'
import { configureAuditWriter, recordAudit } from './index'
import type { AuditInput } from './types'

type Row = Record<string, unknown>
type Delegate = {
  findUnique(args: { where: unknown; select: Row }): Promise<Row | null>
  findMany(args: { where: unknown; select: Row }): Promise<Row[]>
}
const models: Record<
  string,
  { category: string; target: string; fields: string[] }
> = {
  File: {
    category: 'files',
    target: 'file',
    fields: [
      'id',
      'name',
      'userId',
      'mimeType',
      'size',
      'visibility',
      'folderId',
      'isPaste',
      'isOcrProcessed',
      'ocrConfidence',
      'views',
      'downloads',
    ],
  },
  VaultFolder: {
    category: 'folders',
    target: 'folder',
    fields: ['id', 'name', 'userId', 'parentId'],
  },
  VaultTag: {
    category: 'tags',
    target: 'tag',
    fields: ['id', 'name', 'userId'],
  },
  VaultFileTag: {
    category: 'tags',
    target: 'file_tag',
    fields: ['fileId', 'tagId', 'excluded'],
  },
  User: { category: 'accounts', target: 'user', fields: ['id', 'name'] },
  Role: {
    category: 'roles',
    target: 'role',
    fields: ['id', 'name', 'permissions', 'position', 'systemKey'],
  },
  Config: { category: 'settings', target: 'setting', fields: ['id', 'key'] },
  ApiToken: {
    category: 'tokens',
    target: 'token',
    fields: ['id', 'name', 'userId', 'scopes', 'expiresAt', 'revokedAt'],
  },
  UploadProfile: {
    category: 'profiles',
    target: 'upload_profile',
    fields: ['id', 'name', 'userId'],
  },
  Webhook: {
    category: 'webhooks',
    target: 'webhook',
    fields: ['id', 'name', 'userId', 'enabled'],
  },
  WebhookDelivery: {
    category: 'webhooks',
    target: 'delivery',
    fields: ['id', 'eventId', 'status', 'attempts'],
  },
  MailOutbox: {
    category: 'email',
    target: 'mail',
    fields: ['id', 'userId', 'purpose', 'status', 'attempts'],
  },
  ShortenedUrl: {
    category: 'links',
    target: 'link',
    fields: ['id', 'userId', 'clicks'],
  },
  Passkey: {
    category: 'authentication',
    target: 'passkey',
    fields: ['id', 'name', 'userId'],
  },
  EventHandler: {
    category: 'system',
    target: 'event_handler',
    fields: ['id', 'enabled'],
  },
}
const writes = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
])
const noisyFields = new Set([
  'updatedAt',
  'lastUsedAt',
  'storageUsed',
  'totpLastCounter',
  'counter',
])

function snapshot(row: Row | null | undefined, fields: string[]): Row {
  if (!row) return {}
  const output: Row = {}
  for (const field of fields)
    if (row[field] !== undefined) output[field] = row[field]
  if (Array.isArray(row.roles))
    output.roleIds = row.roles.map((role) => (role as Row).id)
  return output
}

/** Values are compared only in memory; configuration values never enter the log. */
function changedSettings(
  before: unknown,
  after: unknown,
  prefix = '',
  depth = 0
): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (!after || typeof after !== 'object' || Array.isArray(after) || depth >= 5)
    return prefix ? [prefix] : []
  const previous = before && typeof before === 'object' ? (before as Row) : {}
  return Array.from(
    new Set([...Object.keys(previous), ...Object.keys(after)])
  ).flatMap((key) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,70}$/.test(key)) return []
    return changedSettings(
      previous[key],
      (after as Row)[key],
      prefix ? `${prefix}.${key}` : key,
      depth + 1
    )
  })
}

/** Instrument supported model writes; infrastructure leases/rate limits are omitted. */
export function withPrismaAudit(base: PrismaClient): PrismaClient {
  configureAuditWriter((data) => base.auditEvent.create({ data }))
  const extended = base.$extends(
    Prisma.defineExtension({
      name: 'instance-audit',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const definition = models[model]
            if (!definition || !writes.has(operation)) return query(args)
            const input = args as Row
            const data = (input.data ??
              input.update ??
              input.create ??
              {}) as Row
            const changedFields = Object.keys(data).filter(
              (field) => !noisyFields.has(field)
            )
            if (operation.startsWith('update') && changedFields.length === 0)
              return query(args)
            const snapshotClient =
              auditContext.getStore()?.transactionClient ?? base
            const delegate = (snapshotClient as Record<string, Delegate>)[
              model[0].toLowerCase() + model.slice(1)
            ]
            // Batch transactions do not expose their bound client to extensions.
            // Avoid taking a second connection while they hold one; production
            // mutations use callback transactions for complete snapshots.
            const canSnapshot =
              !auditContext.getStore()?.pending ||
              Boolean(auditContext.getStore()?.transactionClient)
            const select: Row = Object.fromEntries(
              definition.fields.map((field) => [field, true])
            )
            if (model === 'User') select.roles = { select: { id: true } }
            if (model === 'VaultFileTag') {
              select.file = { select: { name: true } }
              select.tag = { select: { name: true } }
            }
            // Used only to identify changed key paths, never serialized into details.
            if (model === 'Config') select.value = true
            let before: Row[] = []
            const batchTags =
              model === 'VaultFileTag' &&
              operation.startsWith('createMany') &&
              Array.isArray(input.data)
                ? (input.data as Row[]).map((row) => ({
                    fileId: row.fileId,
                    tagId: row.tagId,
                  }))
                : null
            if (batchTags?.length && canSnapshot) {
              try {
                before = await delegate.findMany({
                  where: { OR: batchTags },
                  select,
                })
              } catch {
                /* Fallback logs the attempted batch. */
              }
            }
            if (!operation.startsWith('create') && canSnapshot) {
              try {
                if (operation.includes('Many'))
                  before = await delegate.findMany({
                    where: input.where,
                    select,
                  })
                else {
                  const row = await delegate.findUnique({
                    where: input.where,
                    select,
                  })
                  if (row) before = [row]
                }
              } catch {
                // Snapshot lookup must not change application behavior.
              }
            }
            // Built-in role initialization runs on ordinary reads and is not a change.
            if (
              operation === 'upsert' &&
              Object.keys((input.update as Row) ?? {}).length === 0 &&
              before.length
            )
              return query(args)
            let result: unknown
            try {
              result = await query(args)
            } catch (error) {
              await recordAudit({
                action: `${definition.target}.${operation}`,
                category: definition.category,
                outcome: 'failure',
                targetType: definition.target,
                targetId:
                  typeof before[0]?.id === 'string' ? before[0].id : undefined,
                targetName:
                  typeof before[0]?.name === 'string'
                    ? before[0].name
                    : undefined,
                details: {
                  operation,
                  changedFields,
                  reason: 'Database mutation failed',
                },
              })
              throw error
            }
            if (
              result &&
              typeof result === 'object' &&
              'count' in result &&
              result.count === 0
            )
              return result
            let returned = Array.isArray(result)
              ? result
              : result && typeof result === 'object' && !('count' in result)
                ? [result]
                : []
            if (
              !operation.includes('Many') &&
              !operation.startsWith('delete') &&
              canSnapshot
            ) {
              const returnedId = (returned[0] as Row | undefined)?.id
              const returnedTag = returned[0] as Row | undefined
              const where = returnedId
                ? { id: returnedId }
                : (input.where ??
                  (model === 'VaultFileTag' &&
                  returnedTag?.fileId &&
                  returnedTag.tagId
                    ? {
                        fileId_tagId: {
                          fileId: returnedTag.fileId,
                          tagId: returnedTag.tagId,
                        },
                      }
                    : undefined))
              if (where) {
                try {
                  const after = await delegate.findUnique({ where, select })
                  if (after) returned = [after]
                } catch {
                  /* Fall back to the mutation result when no snapshot is available. */
                }
              }
            }
            if (
              operation.startsWith('updateMany') &&
              before.length &&
              canSnapshot
            ) {
              // Re-read exactly the affected identities, not the original filter
              // (which may no longer match after a visibility/status change).
              const identities = before.map((row) =>
                row.id
                  ? { id: row.id }
                  : { fileId: row.fileId, tagId: row.tagId }
              )
              try {
                returned = await delegate.findMany({
                  where: { OR: identities },
                  select,
                })
              } catch {
                /* Use safe input values below. */
              }
            }
            if (
              operation.startsWith('create') &&
              !returned.length &&
              Array.isArray(input.data)
            )
              returned = input.data
            if (batchTags?.length && canSnapshot) {
              const existing = new Set(
                before.map((row) => `${row.fileId}:${row.tagId}`)
              )
              const inserted = batchTags.filter(
                (row) => !existing.has(`${row.fileId}:${row.tagId}`)
              )
              if (inserted.length) {
                try {
                  returned = await delegate.findMany({
                    where: { OR: inserted },
                    select,
                  })
                } catch {
                  /* Retain the safe insert input as a fallback. */
                }
              }
            }
            const records = operation.startsWith('delete')
              ? before
              : returned.length
                ? (returned as Row[])
                : before
            const count =
              result && typeof result === 'object' && 'count' in result
                ? result.count
                : records.length
            const previousByIdentity = new Map(
              before.map((row) => [row.id ?? `${row.fileId}:${row.tagId}`, row])
            )
            for (const [index, row] of (records.length
              ? records
              : [{}]
            ).entries()) {
              const old =
                previousByIdentity.get(
                  row.id ?? `${row.fileId}:${row.tagId}`
                ) ??
                (operation.startsWith('create') ? undefined : before[index])
              const scalarData = Object.fromEntries(
                Object.entries(data).filter(
                  ([, value]) => value === null || typeof value !== 'object'
                )
              )
              const current = returned.length
                ? { ...old, ...scalarData, ...row }
                : { ...row, ...scalarData }
              const details: Row = {
                operation,
                changedFields,
                count,
                before: snapshot(old, definition.fields),
              }
              if (typeof (current.tag as Row | undefined)?.name === 'string')
                details.tagName = (current.tag as Row).name
              if (!operation.startsWith('delete')) {
                details.after = snapshot(current, definition.fields)
                if (
                  model === 'User' &&
                  data.roles &&
                  typeof data.roles === 'object'
                ) {
                  const roles = data.roles as Row
                  // Capture requested assignment IDs even when select omits roles.
                  const assigned = roles.set ?? roles.connect
                  if (Array.isArray(assigned))
                    details.roleIds = assigned.map((role) => (role as Row).id)
                }
                if (model === 'Config')
                  details.settingsKeys = changedSettings(
                    old?.value,
                    data.value ?? row.value
                  )
              }
              await recordAudit({
                action: `${definition.target}.${operation}`,
                category: definition.category,
                outcome:
                  ['WebhookDelivery', 'MailOutbox'].includes(model) &&
                  (data.status === 'failed' ||
                    (data.status !== 'cancelled' &&
                      typeof data.lastError === 'string' &&
                      data.lastError.length > 0))
                    ? 'failure'
                    : 'success',
                targetType: definition.target,
                targetId:
                  String(
                    current.id ??
                      current.fileId ??
                      (input.where as Row | undefined)?.id ??
                      ''
                  ) || undefined,
                targetName:
                  typeof current.name === 'string'
                    ? current.name
                    : typeof current.key === 'string'
                      ? current.key
                      : typeof (current.file as Row | undefined)?.name ===
                          'string'
                        ? ((current.file as Row).name as string)
                        : undefined,
                details,
              })
            }
            return result
          },
        },
      },
    })
  ) as unknown as PrismaClient

  // Audit writes use a separate connection after commit. Writing before commit
  // would record rolled-back successes and could deadlock a busy connection pool.
  return new Proxy(extended, {
    get(target, property, receiver) {
      if (property !== '$transaction')
        return Reflect.get(target, property, receiver)
      return async (operation: unknown, options?: unknown) => {
        const pending: AuditInput[] = []
        const context = { ...auditContext.getStore(), pending }
        const transact = target.$transaction.bind(target) as (
          operation: unknown,
          options?: unknown
        ) => Promise<unknown>
        let result: unknown
        try {
          result = await auditContext.run(context, () =>
            transact(
              typeof operation === 'function'
                ? (tx: unknown) =>
                    auditContext.run(
                      { ...context, transactionClient: tx },
                      () => operation(tx)
                    )
                : operation,
              options
            )
          )
        } catch (error) {
          for (const event of pending.filter(
            (event) => event.outcome === 'failure'
          ))
            await recordAudit(event)
          throw error
        }
        for (const event of pending) await recordAudit(event)
        return result
      }
    },
  })
}
