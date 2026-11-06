import { Prisma, type PrismaClient } from '@prisma/client'

import { auditContext } from './context'
import { configureAuditWriter, recordAudit, recordAuditMany } from './index'
import { auditedModels } from './models'
import type { AuditInput } from './types'

type Row = Record<string, unknown>
type Delegate = {
  findUnique(args: { where: unknown; select: Row }): Promise<Row | null>
  findMany(args: { where: unknown; select: Row }): Promise<Row[]>
  createManyAndReturn(args: Row): Promise<Row[]>
  updateManyAndReturn(args: Row): Promise<Row[]>
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

function snapshot(row: Row | null | undefined, fields: readonly string[]): Row {
  if (!row) return {}
  const output: Row = {}
  for (const field of fields)
    if (row[field] !== undefined) output[field] = row[field]
  if (Array.isArray(row.roles))
    output.roleIds = row.roles.map((role) => (role as Row).id)
  return output
}

/** Add audit fields to the mutation itself, so a later reader cannot replace its result. */
function withAuditSelection(input: Row, required: Row): Row {
  const output = { ...input }
  if (input.select) {
    const selected = { ...(input.select as Row) }
    for (const [key, value] of Object.entries(required)) {
      selected[key] =
        value === true || !selected[key]
          ? value
          : selected[key] === true
            ? true
            : withAuditSelection(
                selected[key] as Row,
                (value as Row).select as Row
              )
    }
    output.select = selected
  } else {
    const include = { ...(input.include as Row | undefined) }
    for (const [key, value] of Object.entries(required)) {
      if (value === true) continue
      include[key] = !include[key]
        ? value
        : include[key] === true
          ? true
          : withAuditSelection(
              include[key] as Row,
              (value as Row).select as Row
            )
    }
    if (Object.keys(include).length) output.include = include
    if (input.omit) {
      output.omit = { ...(input.omit as Row) }
      for (const [key, selection] of Object.entries(required))
        if (selection === true) (output.omit as Row)[key] = false
    }
  }
  return output
}

/** Return exactly the caller's projection, removing fields fetched only for auditing. */
function callerProjection(value: unknown, input: Row, required: Row): unknown {
  if (Array.isArray(value))
    return value.map((row) => callerProjection(row, input, required))
  if (!value || typeof value !== 'object') return value
  const row = value as Row
  const output: Row = input.select ? {} : { ...row }
  const requested = (input.select ?? input.include ?? {}) as Row
  for (const [key, selection] of Object.entries(requested)) {
    if (!selection) continue
    output[key] =
      typeof selection === 'object'
        ? callerProjection(
            row[key],
            selection as Row,
            ((required[key] as Row | undefined)?.select ?? {}) as Row
          )
        : row[key]
  }
  if (!input.select) {
    for (const [key, selection] of Object.entries(required))
      if (selection !== true && !requested[key]) delete output[key]
    for (const [key, omitted] of Object.entries((input.omit ?? {}) as Row))
      if (omitted) delete output[key]
  }
  return output
}

/** PostgreSQL has no Prisma deleteManyAndReturn: lock and recheck only these identities. */
async function deleteWithSnapshots(
  client: Prisma.TransactionClient,
  model: string,
  keys: readonly string[],
  input: Row,
  select: Row,
  candidates: Row[]
): Promise<Row[]> {
  const delegate = (client as unknown as Record<string, Delegate>)[
    model[0].toLowerCase() + model.slice(1)
  ]
  const sorted = [...candidates].sort((left, right) => {
    for (const key of keys) {
      const order = Buffer.compare(
        Buffer.from(String(left[key])),
        Buffer.from(String(right[key]))
      )
      if (order) return order
    }
    return 0
  })
  // Identifiers come only from the supported model map, never from user input.
  const table = Prisma.raw(`"${model}"`)
  const columns = keys.map((key) => Prisma.raw(`"${key}"`))
  const identities = (rows: Row[]) =>
    rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])))
  const rows: Row[] = []
  for (let offset = 0; offset < sorted.length; offset += 500) {
    const chunk = sorted.slice(offset, offset + 500)
    const predicates = chunk.map(
      (row) =>
        Prisma.sql`(${Prisma.join(
          keys.map((key, index) => Prisma.sql`${columns[index]} = ${row[key]}`),
          ' AND '
        )})`
    )
    await client.$queryRaw(
      Prisma.sql`SELECT ${Prisma.join(columns)} FROM ${table} WHERE ${Prisma.join(predicates, ' OR ')} ORDER BY ${Prisma.join(columns.map((column) => Prisma.sql`${column} COLLATE "C"`))} FOR UPDATE`
    )
    rows.push(
      ...(await delegate.findMany({
        where: { AND: [input.where ?? {}, { OR: identities(chunk) }] },
        select,
      }))
    )
  }
  const removed =
    typeof input.limit === 'number' ? rows.slice(0, input.limit) : rows
  if (!removed.length) return []
  // Keep one DELETE statement: self-referencing NO ACTION foreign keys can
  // require selected parents and children to disappear together. Array
  // parameters also avoid PostgreSQL's bound-parameter limit for large batches.
  const values = keys.map((key) => removed.map((row) => String(row[key])))
  const predicate =
    keys.length === 1
      ? Prisma.sql`${columns[0]} = ANY(${values[0]}::text[])`
      : Prisma.sql`(${Prisma.join(columns)}) IN (SELECT * FROM unnest(${values[0]}::text[], ${values[1]}::text[]))`
  const count = await client.$executeRaw(
    Prisma.sql`DELETE FROM ${table} WHERE ${predicate}`
  )
  if (count !== removed.length)
    throw new Error(
      'Bulk deletion affected an unexpected number of locked rows'
    )
  return removed
}

/**
 * Records writes to the models in `auditedModels`. Audit events themselves
 * are written through `base`, so this extension never sees them.
 */
export function withPrismaAudit(base: PrismaClient): PrismaClient {
  configureAuditWriter(
    (data) => base.auditEvent.create({ data }),
    (data) => base.auditEvent.createMany({ data })
  )
  const extended = base.$extends(
    Prisma.defineExtension({
      name: 'instance-audit',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const definition = auditedModels[model]
            if (
              !definition ||
              !writes.has(operation) ||
              auditContext.getStore()?.prismaAuditDisabled
            )
              return query(args)
            const input = args as Row
            const data = (input.data ??
              input.update ??
              input.create ??
              {}) as Row
            const changedFields = [
              ...new Set(
                (Array.isArray(data) ? data : [data]).flatMap((row) =>
                  Object.keys(row as Row)
                )
              ),
            ].filter((field) => !noisyFields.has(field))
            if (
              operation.startsWith('update') &&
              changedFields.every((field) =>
                definition.counters?.includes(field)
              )
            )
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
            const select: Row = {
              ...Object.fromEntries(
                definition.fields.map((field) => [field, true])
              ),
              ...definition.select,
            }
            if (definition.roles && !operation.includes('Many'))
              select.roles = { select: { id: true } }
            const keys = definition.keys ?? ['id']
            const identity = (row: Row) =>
              keys.map((key) => String(row[key])).join(':')
            let before: Row[] = []
            let beforeLookupFailed = false
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
                beforeLookupFailed = true
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
            let returned: Row[] = []
            // PostgreSQL RETURNING identifies exactly the rows this bulk write changed,
            // including skipDuplicates and predicates that no longer match afterwards.
            const returningOperation =
              canSnapshot && operation === 'createMany'
                ? 'createManyAndReturn'
                : canSnapshot && operation === 'updateMany'
                  ? 'updateManyAndReturn'
                  : null
            const returnsRows = ![
              'createMany',
              'updateMany',
              'deleteMany',
            ].includes(operation)
            try {
              if (
                operation === 'deleteMany' &&
                canSnapshot &&
                !beforeLookupFailed &&
                Object.keys(input).every(
                  (key) => key === 'where' || key === 'limit'
                ) &&
                (input.limit === undefined ||
                  (typeof input.limit === 'number' &&
                    Number.isInteger(input.limit) &&
                    input.limit >= 0))
              ) {
                const remove = async (tx: Prisma.TransactionClient) =>
                  auditContext.run(
                    { ...auditContext.getStore(), prismaAuditDisabled: true },
                    async () =>
                      await deleteWithSnapshots(
                        tx,
                        model,
                        keys,
                        input,
                        select,
                        before
                      )
                  )
                const transaction = auditContext.getStore()?.transactionClient
                before = transaction
                  ? await remove(transaction as Prisma.TransactionClient)
                  : await base.$transaction(remove)
                returned = before
                result = { count: returned.length }
              } else if (returningOperation) {
                returned = await auditContext.run(
                  { ...auditContext.getStore(), prismaAuditDisabled: true },
                  async () =>
                    await delegate[returningOperation]({ ...input, select })
                )
                result = { count: returned.length }
              } else {
                const mutationResult = await query(
                  (returnsRows
                    ? withAuditSelection(input, select)
                    : args) as typeof args
                )
                if (returnsRows) {
                  returned = (
                    Array.isArray(mutationResult)
                      ? mutationResult
                      : [mutationResult]
                  ) as Row[]
                  result = callerProjection(mutationResult, input, select)
                } else result = mutationResult
              }
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
            if (Array.isArray(result) && !result.length) return result
            // Count-only array-transaction results cannot be enriched on another
            // connection without escaping that transaction. Record an aggregate
            // rather than claim attempted inputs were actually written.
            const records = returned
            const count =
              result && typeof result === 'object' && 'count' in result
                ? result.count
                : records.length
            const previousByIdentity = new Map(
              before.map((row) => [identity(row), row])
            )
            const events: AuditInput[] = []
            for (const row of records.length ? records : [{}]) {
              const old = operation.startsWith('delete')
                ? row
                : operation.startsWith('create')
                  ? undefined
                  : previousByIdentity.get(identity(row))
              const current = { ...row }
              const requestedRoles = (
                (input.select ?? input.include) as Row | undefined
              )?.roles
              if (
                definition.roles &&
                requestedRoles &&
                typeof requestedRoles === 'object' &&
                ['where', 'cursor', 'skip', 'take', 'distinct'].some(
                  (key) => key in requestedRoles
                )
              ) {
                // A caller-filtered relation is not a complete assignment snapshot.
                delete current.roles
              }
              const details: Row = {
                operation,
                changedFields,
                count,
                before: snapshot(old, definition.fields),
                ...(old && !operation.startsWith('delete')
                  ? { beforeObserved: true }
                  : {}),
              }
              if (!operation.startsWith('delete')) {
                details.after = snapshot(current, definition.fields)
                if (
                  definition.roles &&
                  data.roles &&
                  typeof data.roles === 'object'
                ) {
                  const roles = data.roles as Row
                  // Capture requested assignment IDs even when select omits roles.
                  const assigned = roles.set ?? roles.connect
                  if (Array.isArray(assigned))
                    details.roleIds = assigned.map((role) => (role as Row).id)
                }
              }
              Object.assign(
                details,
                definition.details?.(current, old, operation)
              )
              const name = definition.name
                ? definition.name(current)
                : current.name
              events.push({
                action: `${definition.target}.${operation}`,
                category: definition.category,
                outcome: definition.failed?.(data) ? 'failure' : 'success',
                targetType: definition.target,
                targetId:
                  String(
                    current[keys[0]] ??
                      (input.where as Row | undefined)?.id ??
                      ''
                  ) || undefined,
                targetName: typeof name === 'string' ? name : undefined,
                details,
              })
            }
            await recordAuditMany(events)
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
          await recordAuditMany(
            pending.filter((event) => event.outcome === 'failure')
          )
          throw error
        }
        await recordAuditMany(pending)
        return result
      }
    },
  })
}
