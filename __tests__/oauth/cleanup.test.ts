import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteExpiredTransfers } from '@/lib/mcp/transfer'
import { startTransferCleanupWorker } from '@/lib/mcp/worker'
import { SWEEP_BATCH, cleanUpSignIn, inBatches } from '@/lib/oauth/cleanup'

type Statement = { sql: string; values: unknown[] }

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown]>,
  failing: null as string | null,
  /** What a statement removes each time it runs; the last answer repeats. */
  removes: {} as Record<string, number[]>,
  /** The connections nobody holds, for each time they are asked for. */
  free: [] as string[][],
  warn: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => {
  const statement = (
    strings: TemplateStringsArray,
    values: unknown[]
  ): Statement => ({
    sql: strings.join('?').replace(/\s+/g, ' ').trim(),
    values,
  })
  /** Which sweep a statement is, from the table it deletes from. */
  const nameOf = (sql: string) => {
    const table = /DELETE FROM "(\w+)"/.exec(sql)?.[1]
    if (table === 'OAuthClient')
      return sql.includes('OFFSET') ? 'evicted' : 'stale'
    return (
      { AgentTransfer: 'transfers', OAuthCode: 'codes', AgentToken: 'pairs' }[
        table ?? ''
      ] ?? 'unknown'
    )
  }
  const answer = (name: string) => {
    const answers = db.removes[name] ?? [0]
    return answers.length > 1 ? answers.shift()! : answers[0]
  }
  const run = (name: string, detail: unknown) => {
    db.calls.push([name, detail])
    if (db.failing === name) throw new Error('Database unavailable')
  }
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      run('connections.take', statement(strings, values))
      return (db.free.length > 1 ? db.free.shift()! : (db.free[0] ?? [])).map(
        (id) => ({ id })
      )
    },
    agentConnection: {
      deleteMany: async (query: { where: { id: { in: string[] } } }) => {
        run('connections.delete', query)
        return { count: query.where.id.in.length }
      },
    },
  }
  return {
    prisma: {
      $executeRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const detail = statement(strings, values)
        const name = nameOf(detail.sql)
        run(name, detail)
        return answer(name)
      },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    },
  }
})
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ warn: db.warn }) }))

const NOW = new Date('2026-11-21T12:00:00.000Z')
const names = () => db.calls.map(([name]) => name)
const statements = (name: string) =>
  db.calls
    .filter(([called]) => called === name)
    .map(([, detail]) => detail as Statement)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  db.calls.length = 0
  db.failing = null
  db.removes = {}
  db.free = []
})
afterEach(() => vi.useRealTimers())

describe('cleaning up after agent sign-in', () => {
  it('removes expired codes, unused registrations, expired pairs and ended connections, in that order', async () => {
    db.removes = { codes: [3], stale: [2], evicted: [4], pairs: [5] }
    db.free = [['c1']]
    expect(await cleanUpSignIn(NOW)).toEqual({
      codes: 3,
      // Two that were a day old, four beyond the five hundred.
      clients: 6,
      pairs: 5,
      connections: 1,
    })
    expect(db.calls).toEqual([
      [
        'codes',
        {
          sql: `WITH gone AS MATERIALIZED ( SELECT "hash" FROM "OAuthCode" WHERE "expiresAt" <= (?::timestamptz AT TIME ZONE 'UTC') ORDER BY "hash" LIMIT ? FOR UPDATE SKIP LOCKED ) DELETE FROM "OAuthCode" USING gone WHERE "OAuthCode"."hash" = gone."hash"`,
          values: [NOW, 1000],
        },
      ],
      [
        'stale',
        {
          // Never one somebody approved, where it is taken and where it goes.
          sql: `WITH gone AS MATERIALIZED ( SELECT "id" FROM "OAuthClient" WHERE "usedAt" IS NULL AND "createdAt" <= (?::timestamptz AT TIME ZONE 'UTC') ORDER BY "id" LIMIT ? FOR UPDATE SKIP LOCKED ) DELETE FROM "OAuthClient" USING gone WHERE "OAuthClient"."id" = gone."id" AND "OAuthClient"."usedAt" IS NULL`,
          values: [new Date('2026-11-20T12:00:00.000Z'), 1000],
        },
      ],
      [
        'evicted',
        {
          // The newest five hundred are read in a query of their own, which
          // holds none of them.
          sql: `WITH gone AS MATERIALIZED ( SELECT "id" FROM "OAuthClient" WHERE "usedAt" IS NULL AND "id" IN ( SELECT "id" FROM "OAuthClient" WHERE "usedAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC OFFSET ? ) ORDER BY "id" LIMIT ? FOR UPDATE SKIP LOCKED ) DELETE FROM "OAuthClient" USING gone WHERE "OAuthClient"."id" = gone."id" AND "OAuthClient"."usedAt" IS NULL`,
          values: [500, 1000],
        },
      ],
      [
        'pairs',
        {
          sql: `WITH gone AS MATERIALIZED ( SELECT "id" FROM "AgentToken" WHERE "refreshExpiresAt" <= (?::timestamptz AT TIME ZONE 'UTC') ORDER BY "id" LIMIT ? FOR UPDATE SKIP LOCKED ) DELETE FROM "AgentToken" USING gone WHERE "AgentToken"."id" = gone."id"`,
          values: [NOW, 1000],
        },
      ],
      [
        'connections.take',
        {
          // Ended, pairless, or holding an administration scope 30 days on.
          sql: `SELECT c."id" FROM "AgentConnection" AS c WHERE c."revokedAt" IS NOT NULL OR NOT EXISTS ( SELECT 1 FROM "AgentToken" AS t WHERE t."connectionId" = c."id" ) OR ( c."scopes" && ?::text[] AND c."createdAt" <= (?::timestamptz AT TIME ZONE 'UTC') ) ORDER BY c."id" LIMIT ? FOR UPDATE OF c SKIP LOCKED`,
          values: [
            ['admin:read', 'admin:users', 'admin:content', 'admin:settings'],
            new Date('2026-10-22T12:00:00.000Z'),
            1000,
          ],
        },
      ],
      [
        'connections.delete',
        {
          where: {
            // The rows it took, and still only ones that are over.
            id: { in: ['c1'] },
            OR: [
              { revokedAt: { not: null } },
              { tokens: { none: {} } },
              {
                scopes: {
                  hasSome: [
                    'admin:read',
                    'admin:users',
                    'admin:content',
                    'admin:settings',
                  ],
                },
                createdAt: { lte: new Date('2026-10-22T12:00:00.000Z') },
              },
            ],
          },
        },
      ],
    ])
  })

  it('measures against now when it is given no time', async () => {
    await cleanUpSignIn()
    expect(statements('codes')[0].values[0]).toEqual(NOW)
    expect(statements('pairs')[0].values[0]).toEqual(NOW)
  })

  it('never waits for a row: every statement takes only rows nobody holds, in id order', async () => {
    db.free = [['c1']]
    await cleanUpSignIn(NOW)
    const taking = db.calls
      .map(([, detail]) => (detail as Partial<Statement>).sql)
      .filter((sql): sql is string => typeof sql === 'string')
    expect(taking).toHaveLength(5)
    for (const sql of taking) {
      expect(sql).toMatch(
        /ORDER BY (c\.)?"(id|hash)" LIMIT \? FOR UPDATE( OF c)? SKIP LOCKED/
      )
      // And none of them waits in any other way.
      expect(sql).not.toMatch(/NOWAIT|FOR SHARE|LOCK TABLE/)
    }
  })

  it('compares times as UTC without a zone, whatever zone the session is in', async () => {
    await cleanUpSignIn(NOW)
    for (const name of ['codes', 'stale', 'pairs', 'connections.take'])
      expect(statements(name)[0].sql).toContain(
        `<= (?::timestamptz AT TIME ZONE 'UTC')`
      )
  })

  it('takes a thousand rows at a time, until a batch comes back short', async () => {
    db.removes = { codes: [1000, 1000, 7], pairs: [1000, 0] }
    db.free = [Array.from({ length: 1000 }, (_, index) => `c${index}`), ['x']]
    expect(await cleanUpSignIn(NOW)).toEqual({
      codes: 2007,
      clients: 0,
      pairs: 1000,
      connections: 1001,
    })
    expect(names().filter((name) => name === 'codes')).toHaveLength(3)
    expect(names().filter((name) => name === 'stale')).toHaveLength(1)
    expect(names().filter((name) => name === 'pairs')).toHaveLength(2)
    expect(names().filter((name) => name === 'connections.take')).toHaveLength(
      2
    )
  })

  it('leaves the audited delete alone when no connection is free', async () => {
    await cleanUpSignIn(NOW)
    expect(names()).toContain('connections.take')
    expect(names()).not.toContain('connections.delete')
  })
})

describe('sweeping expired transfer URLs', () => {
  it('takes only URLs nobody holds, a thousand at a time, measured in UTC', async () => {
    db.removes = { transfers: [1000, 12] }
    expect(await deleteExpiredTransfers(NOW)).toBe(1012)
    expect(statements('transfers')).toEqual(
      Array.from({ length: 2 }, () => ({
        sql: `WITH gone AS MATERIALIZED ( SELECT "id" FROM "AgentTransfer" WHERE "expiresAt" <= (?::timestamptz AT TIME ZONE 'UTC') ORDER BY "id" LIMIT ? FOR UPDATE SKIP LOCKED ) DELETE FROM "AgentTransfer" USING gone WHERE "AgentTransfer"."id" = gone."id"`,
        values: [NOW, 1000],
      }))
    )
  })

  it('measures against now when it is given no time', async () => {
    await deleteExpiredTransfers()
    expect(statements('transfers')[0].values[0]).toEqual(NOW)
  })
})

describe('sweeping in batches', () => {
  it('stops at the first batch that is not full', async () => {
    const remove = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(SWEEP_BATCH)
      .mockResolvedValueOnce(SWEEP_BATCH - 1)
    expect(await inBatches(remove)).toBe(2 * SWEEP_BATCH - 1)
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('runs once when there is nothing to remove', async () => {
    const remove = vi.fn(async () => 0)
    expect(await inBatches(remove)).toBe(0)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('ends after fifty batches even if every one comes back full', async () => {
    const remove = vi.fn(async () => SWEEP_BATCH)
    expect(await inBatches(remove)).toBe(50 * SWEEP_BATCH)
    expect(remove).toHaveBeenCalledTimes(50)
  })
})

describe('the cleanup worker', () => {
  let worker: ReturnType<typeof startTransferCleanupWorker> | undefined
  afterEach(() => {
    worker?.stop()
    worker = undefined
  })
  const ONE_RUN = [
    'transfers',
    'codes',
    'stale',
    'evicted',
    'pairs',
    'connections.take',
  ]

  it('sweeps transfer URLs and then sign-in leftovers, every 15 minutes', async () => {
    worker = startTransferCleanupWorker()
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1)
    expect(db.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(names()).toEqual(ONE_RUN)
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(names()).toEqual([...ONE_RUN, ...ONE_RUN])
    expect(db.warn).not.toHaveBeenCalled()
  })

  it('says so on its own line when the sign-in cleanup fails, without what failed, and tries again', async () => {
    db.failing = 'stale'
    worker = startTransferCleanupWorker()
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    // The transfer sweep had already run.
    expect(names()).toEqual(['transfers', 'codes', 'stale'])
    expect(db.warn.mock.calls).toEqual([
      ['Agent sign-in cleanup unavailable; retrying on the next run.'],
    ])
    db.failing = null
    db.calls.length = 0
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(names()).toEqual(ONE_RUN)
    expect(db.warn).toHaveBeenCalledTimes(1)
  })

  it('keeps its own message for a failed transfer sweep', async () => {
    db.failing = 'transfers'
    worker = startTransferCleanupWorker()
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(db.warn.mock.calls).toEqual([
      ['Transfer URL cleanup unavailable; retrying on the next run.'],
    ])
  })
})
