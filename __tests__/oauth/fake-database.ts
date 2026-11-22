/**
 * The few tables agent sign-in uses, held in memory, with the queries the
 * code makes of them. It has no transactions: one request runs at a time
 * here, and what depends on two running together is tested against
 * PostgreSQL in `__tests__/mcp/database.test.ts`.
 */
type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition === undefined) return true
    if (key === 'NOT') return !matches(row, condition as Where)
    if (condition === null) return value === null
    if (condition instanceof Date)
      return value instanceof Date && value.getTime() === condition.getTime()
    if (typeof condition === 'object') {
      const test = condition as {
        gt?: Date
        lte?: Date
        not?: unknown
        hasSome?: unknown[]
      }
      if ('hasSome' in test)
        // A row written without the column holds none, as its default does.
        return ((value as unknown[] | undefined) ?? []).some((item) =>
          test.hasSome!.includes(item)
        )
      if ('gt' in test) return (value as Date) > test.gt!
      if ('lte' in test) return (value as Date) <= test.lte!
      if ('not' in test) return value !== test.not
      throw new Error(`The fake database has no "${key}" condition like this`)
    }
    return value === condition
  })
}

export function fakeDatabase() {
  const tables = {
    users: [] as Row[],
    clients: [] as Row[],
    codes: [] as Row[],
    connections: [] as Row[],
    tokens: [] as Row[],
    transfers: [] as Row[],
  }
  const calls: string[] = []
  let next = 1
  /** `settings` is the saved settings document a transaction reads, or null for none. */
  const state = { failing: false, settings: null as unknown }
  const note = (call: string) => {
    calls.push(call)
    if (state.failing) throw new Error('connection to 10.0.0.3:5432 refused')
  }
  const userOf = (id: unknown) =>
    tables.users.find((user) => user.id === id) ?? null
  const connectionOf = (id: unknown) => {
    const connection = tables.connections.find((row) => row.id === id)
    return connection
      ? { ...connection, user: userOf(connection.userId) }
      : null
  }
  const updateMany = (table: Row[], where: Where, data: Row) => {
    const found = table.filter((row) => matches(row, where))
    for (const row of found) Object.assign(row, data)
    return { count: found.length }
  }
  const deleteMany = (name: keyof typeof tables, where: Where) => {
    const kept = tables[name].filter((row) => !matches(row, where))
    const count = tables[name].length - kept.length
    tables[name] = kept
    return { count }
  }

  const client = {
    oAuthClient: {
      findUnique: async ({ where }: { where: Where }) => {
        note('oAuthClient.findUnique')
        return tables.clients.find((row) => matches(row, where)) ?? null
      },
    },
    oAuthCode: {
      findUnique: async ({ where }: { where: Where }) => {
        note('oAuthCode.findUnique')
        const code = tables.codes.find((row) => matches(row, where))
        return code ? { ...code, user: userOf(code.userId) } : null
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        note('oAuthCode.updateMany')
        return updateMany(tables.codes, where, data)
      },
      update: async ({ where, data }: { where: Where; data: Row }) => {
        note('oAuthCode.update')
        updateMany(tables.codes, where, data)
        return {}
      },
    },
    agentConnection: {
      count: async ({ where }: { where: Where }) => {
        note('agentConnection.count')
        const { tokens, ...rest } = where as Where & {
          tokens?: { some: Where }
        }
        return tables.connections.filter(
          (row) =>
            matches(row, rest) &&
            (!tokens ||
              tables.tokens.some(
                (token) =>
                  token.connectionId === row.id && matches(token, tokens.some)
              ))
        ).length
      },
      create: async ({ data }: { data: Row }) => {
        note('agentConnection.create')
        const row = {
          id: `connection-${next++}`,
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
          revokedReason: null,
          ...data,
        }
        tables.connections.push(row)
        return row
      },
      findUnique: async ({ where }: { where: Where }) => {
        note('agentConnection.findUnique')
        const row = tables.connections.find((one) => matches(one, where))
        return row ? connectionOf(row.id) : null
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        note('agentConnection.updateMany')
        return updateMany(tables.connections, where, data)
      },
    },
    agentToken: {
      create: async ({ data }: { data: Row }) => {
        note('agentToken.create')
        const row = {
          id: `pair-${next++}`,
          rotatedAt: null,
          createdAt: new Date(),
          ...data,
        }
        tables.tokens.push(row)
        return row
      },
      findUnique: async ({ where }: { where: Where }) => {
        note('agentToken.findUnique')
        const row = tables.tokens.find((one) => matches(one, where))
        return row
          ? { ...row, connection: connectionOf(row.connectionId) }
          : null
      },
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        note('agentToken.updateMany')
        return updateMany(tables.tokens, where, data)
      },
      count: async ({ where }: { where: Where }) => {
        note('agentToken.count')
        return tables.tokens.filter((row) => matches(row, where)).length
      },
      // Oldest first, which is the one order the code asks for.
      findMany: async ({ where, take }: { where: Where; take: number }) => {
        note('agentToken.findMany')
        return tables.tokens
          .filter((row) => matches(row, where))
          .sort(
            (a, b) =>
              (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()
          )
          .slice(0, take)
      },
      deleteMany: async ({ where }: { where: Where }) => {
        note('agentToken.deleteMany')
        return deleteMany('tokens', where)
      },
    },
    // The one statement written out in SQL here: ending a connection removes
    // the transfer URLs made for it, passing over any that somebody else
    // holds. Nobody else is here to hold one.
    $executeRaw: async (
      statement: TemplateStringsArray,
      credential: string
    ) => {
      const sql = statement.join('?')
      // The settings lock: nobody else is here to hold it.
      if (/^SELECT pg_advisory_xact_lock\(721150092\)$/.test(sql)) {
        note('settingsLock')
        return 1
      }
      if (
        !/FROM "AgentTransfer"\s+WHERE "credential" = \?\s+ORDER BY "id" FOR UPDATE SKIP LOCKED/.test(
          sql
        )
      )
        throw new Error(`The fake database has no statement like this: ${sql}`)
      note('agentTransfer.delete')
      return deleteMany('transfers', { credential }).count
    },
    config: {
      findUnique: async () => {
        note('config.findUnique')
        return state.settings === null ? null : { value: state.settings }
      },
    },
    // Row locks: one request runs at a time here, so there is nothing to wait for.
    $queryRaw: async () => {
      note('lock')
      return []
    },
    $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      note('transaction')
      return run(client)
    },
  }
  return {
    client,
    tables,
    calls,
    state,
    reset() {
      for (const name of Object.keys(tables) as (keyof typeof tables)[])
        tables[name] = []
      calls.length = 0
      next = 1
      state.failing = false
      state.settings = null
    },
  }
}
