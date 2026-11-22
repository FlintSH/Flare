import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { auditContext } from '@/lib/audit/context'
import { sessionRevocation } from '@/lib/auth/security/service'
import {
  connectionHolds,
  connectionKey,
  effectiveScopes,
  holdConnection,
  lockConnection,
  revokeAccountConnections,
  revokeConnection,
} from '@/lib/oauth/connections'
import { changeCredentials } from '@/lib/users/credentials'

vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/email/tokens', () => ({ invalidateEmailTokens: vi.fn() }))

const events: Partial<AuditInput>[] = []
beforeEach(() => {
  events.length = 0
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
})
afterEach(() => auditSettled())

/** A transaction that records each plain statement it is given. */
function statements(revoked = 0) {
  const sent: Array<{ sql: string; values: unknown[] }> = []
  const order: string[] = []
  const tx = {
    $executeRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ').trim()
        sent.push({ sql, values })
        order.push(sql.split(' ').slice(0, 3).join(' '))
        return sql.startsWith('UPDATE "AgentConnection"') ? revoked : 1
      }
    ),
    authChallenge: {
      deleteMany: vi.fn(async () => {
        order.push('authChallenge.deleteMany')
        return { count: 0 }
      }),
    },
  }
  return { tx: tx as never, raw: tx, sent, order }
}

describe('what a token pair can do', () => {
  const granted = ['files:read', 'files:content', 'urls:read']

  it('is the whole grant when the pair has no ceiling of its own', () => {
    expect(effectiveScopes(granted, { narrowed: false, scopes: [] })).toEqual(
      granted
    )
    // The column is ignored unless the pair is narrowed.
    expect(
      effectiveScopes(granted, { narrowed: false, scopes: ['files:read'] })
    ).toEqual(granted)
  })

  it('is the grant within the ceiling of a narrowed pair', () => {
    expect(
      effectiveScopes(granted, {
        narrowed: true,
        scopes: ['urls:read', 'files:delete', 'files:read'],
      })
    ).toEqual(['files:read', 'urls:read'])
    expect(effectiveScopes(granted, { narrowed: true, scopes: [] })).toEqual([])
    expect(
      effectiveScopes([], { narrowed: true, scopes: ['files:read'] })
    ).toEqual([])
  })

  it('never holds the marker or a scope that does not exist, whatever the rows hold', () => {
    expect(
      effectiveScopes(['mcp', 'files:read', 'admin:everything'], {
        narrowed: true,
        scopes: ['mcp', 'files:read', 'admin:everything'],
      })
    ).toEqual(['files:read'])
    expect(effectiveScopes(['mcp'], { narrowed: false, scopes: [] })).toEqual(
      []
    )
  })

  it('is stated in catalog order, each scope once', () => {
    expect(
      effectiveScopes(
        ['urls:write', 'files:read', 'files:upload', 'files:read'],
        {
          narrowed: false,
          scopes: [],
        }
      )
    ).toEqual(['files:upload', 'files:read', 'urls:write'])
  })
})

describe('the key of a connection', () => {
  it('names its kind, so it is never taken for a named token', () => {
    expect(connectionKey('abc')).toBe('connection:abc')
  })
})

describe('ending one connection', () => {
  function transaction(count: number) {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      agentConnection: { updateMany: vi.fn(async () => ({ count })) },
      agentToken: { deleteMany: vi.fn(async () => ({ count: 3 })) },
      $executeRaw: vi.fn(async () => 1),
    }
    return { tx: tx as never, raw: tx }
  }
  /** The one statement that removes transfer URLs, and the value it was given. */
  const transferDelete = (raw: ReturnType<typeof transaction>['raw']) => {
    const [statement, ...values] = raw.$executeRaw.mock.calls[0] as unknown as [
      string[],
      ...unknown[],
    ]
    return { sql: statement.join('?').replace(/\s+/g, ' ').trim(), values }
  }

  it("takes the connection's row first, before it reads or changes anything", async () => {
    const { tx, raw } = transaction(1)
    await revokeConnection(tx, { id: 'c1', userId: 'alex' }, 'disconnected')
    const [statement, id] = raw.$queryRaw.mock.calls[0] as unknown as [
      string[],
      string,
    ]
    expect(statement.join('?')).toBe(
      'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR UPDATE'
    )
    expect(id).toBe('c1')
    const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
      mock.mock.invocationCallOrder[0]
    expect(order(raw.$queryRaw)).toBeLessThan(
      order(raw.agentConnection.updateMany)
    )
    // The order everywhere: the connection, then its pairs and transfer URLs.
    expect(order(raw.agentConnection.updateMany)).toBeLessThan(
      order(raw.agentToken.deleteMany)
    )
    expect(order(raw.agentToken.deleteMany)).toBeLessThan(
      order(raw.$executeRaw)
    )
  })

  it('marks it revoked only while it is live, then removes its pairs and transfer URLs', async () => {
    const { tx, raw } = transaction(1)
    expect(await revokeConnection(tx, { id: 'c1' }, 'replay')).toBe(true)
    expect(raw.agentConnection.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'c1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'replay' },
    })
    expect(raw.agentToken.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { connectionId: 'c1' },
    })
    expect(raw.$executeRaw).toHaveBeenCalledOnce()
    expect(transferDelete(raw)).toEqual({
      // Only the URLs nobody else holds: it never waits for one.
      sql: 'WITH free AS MATERIALIZED ( SELECT "id" FROM "AgentTransfer" WHERE "credential" = ? ORDER BY "id" FOR UPDATE SKIP LOCKED ) DELETE FROM "AgentTransfer" USING free WHERE "AgentTransfer"."id" = free."id"',
      values: ['connection:c1'],
    })
  })

  it('is held to the account when one is named', async () => {
    const { tx, raw } = transaction(1)
    await revokeConnection(tx, { id: 'c1', userId: 'alex' }, 'disconnected')
    expect(raw.agentConnection.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'c1', userId: 'alex', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'disconnected' },
    })
  })

  it('touches nothing of a connection it did not end', async () => {
    const { tx, raw } = transaction(0)
    expect(
      await revokeConnection(tx, { id: 'c1', userId: 'sam' }, 'revoked')
    ).toBe(false)
    expect(raw.agentToken.deleteMany).not.toHaveBeenCalled()
    expect(raw.$executeRaw).not.toHaveBeenCalled()
  })
})

describe('ending every connection of an account', () => {
  it("locks the account, then its connections' rows, discards its codes, then revokes, in that order", async () => {
    const { tx, sent } = statements(2)
    await revokeAccountConnections(tx, 'user-alex', 'sessions-revoked')
    expect(sent.map(({ sql }) => sql)).toEqual([
      // The account's row before any connection's: the order everywhere.
      'SELECT 1 FROM "User" WHERE "id" = ? FOR UPDATE',
      'SELECT 1 FROM "AgentConnection" WHERE "userId" = ? ORDER BY "id" FOR UPDATE',
      'DELETE FROM "OAuthCode" WHERE "userId" = ?',
      `UPDATE "AgentConnection" SET "revokedAt" = (NOW() AT TIME ZONE 'UTC'), "revokedReason" = ? WHERE "userId" = ? AND "revokedAt" IS NULL`,
      'DELETE FROM "AgentToken" USING "AgentConnection" WHERE "AgentToken"."connectionId" = "AgentConnection"."id" AND "AgentConnection"."userId" = ?',
      `DELETE FROM "AgentTransfer" WHERE "userId" = ? AND "credential" LIKE 'connection:%'`,
    ])
    // Every statement is held to the one account, as a bound parameter.
    expect(sent.map(({ values }) => values)).toEqual([
      ['user-alex'],
      ['user-alex'],
      ['user-alex'],
      ['sessions-revoked', 'user-alex'],
      ['user-alex'],
      ['user-alex'],
    ])
  })

  it('binds the account id, so no id can reach the SQL text', async () => {
    const { tx, sent } = statements(0)
    const hostile = `x' OR '1'='1'; DROP TABLE "User"; --`
    await revokeAccountConnections(tx, hostile, 'sessions-revoked')
    for (const { sql, values } of sent) {
      expect(sql).not.toContain('DROP TABLE')
      expect(values).toContain(hostile)
    }
  })

  it('records how many it ended, against the account, once the transaction is done', async () => {
    const { tx } = statements(3)
    await auditContext.run(
      { requestId: 'r1', actorId: 'admin', actorName: 'Admin' },
      () => revokeAccountConnections(tx, 'user-alex', 'sessions-revoked')
    )
    expect(events).toEqual([
      expect.objectContaining({
        action: 'agent_connection.revokeAll',
        category: 'authentication',
        outcome: 'success',
        actorId: 'admin',
        actorName: 'Admin',
        targetType: 'user',
        targetId: 'user-alex',
        details: expect.objectContaining({
          count: 3,
          reason: 'sessions-revoked',
        }),
      }),
    ])
  })

  it('records nothing for an account that had no agent', async () => {
    const { tx } = statements(0)
    await revokeAccountConnections(tx, 'user-alex', 'sessions-revoked')
    expect(events).toEqual([])
  })

  it('holds the event back while its transaction is open', async () => {
    const pending: AuditInput[] = []
    const { tx } = statements(1)
    await auditContext.run({ pending }, () =>
      revokeAccountConnections(tx, 'user-alex', 'sessions-revoked')
    )
    // Queued for the commit; a rollback would drop it.
    expect(events).toEqual([])
    expect(pending).toEqual([
      expect.objectContaining({ action: 'agent_connection.revokeAll' }),
    ])
  })
})

describe('signing an account out everywhere', () => {
  it('ends its agents in the transaction it is given, and still returns only the version change', async () => {
    const { tx, raw, order } = statements(1)
    const change = await sessionRevocation(tx, 'user-alex')
    expect(change).toEqual({ sessionVersion: { increment: 1 } })
    expect(raw.authChallenge.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: 'user-alex' },
    })
    expect(order).toEqual([
      'authChallenge.deleteMany',
      'SELECT 1 FROM',
      'SELECT 1 FROM',
      'DELETE FROM "OAuthCode"',
      'UPDATE "AgentConnection" SET',
      'DELETE FROM "AgentToken"',
      'DELETE FROM "AgentTransfer"',
    ])
    expect(raw.$executeRaw.mock.calls[3].slice(1)).toEqual([
      'sessions-revoked',
      'user-alex',
    ])
  })

  it('does not sign the account out when ending its agents fails', async () => {
    const { tx, raw } = statements(1)
    raw.$executeRaw.mockRejectedValueOnce(new Error('deadlock detected'))
    await expect(sessionRevocation(tx, 'user-alex')).rejects.toThrow(
      'deadlock detected'
    )
  })

  it('is what a new password or sign-in address goes through', async () => {
    for (const credentials of [
      { password: 'new-hash' },
      { email: { address: 'new@example.test', verified: true } },
      { rotateUploadToken: true },
    ]) {
      const { tx, order } = statements(1)
      const change = await changeCredentials(tx, 'user-alex', credentials)
      expect(change).toMatchObject({ sessionVersion: { increment: 1 } })
      expect(order).toContain('UPDATE "AgentConnection" SET')
      expect(order).toContain('DELETE FROM "OAuthCode"')
    }
  })
})

describe("every action that ends an account's agents", () => {
  /**
   * Each place in the app that signs an account out everywhere, with what
   * the person or an administrator did there. All of them reach
   * `sessionRevocation`, which ends the account's agents in the same
   * transaction. The database suite drives every one of these against
   * PostgreSQL ("what ends an account's agents").
   */
  const CALLERS: Array<[file: string, calls: string, actions: string[]]> = [
    // "I may be compromised."
    [
      'lib/auth/sessions.ts',
      'revokeSecuritySessions',
      ['signing out everywhere'],
    ],
    [
      'app/api/users/[id]/sessions/route.ts',
      'revokeSecuritySessions',
      ['an administrator signing the account out'],
    ],
    [
      'lib/mcp/tools/users.ts',
      'revokeSecuritySessions',
      ['an agent signing another account out with update_user'],
    ],
    [
      'lib/users/update-account.ts',
      'changeCredentials',
      [
        'a new password or sign-in address, saved in the profile or by an administrator',
      ],
    ],
    [
      'lib/email/account.ts',
      'changeCredentials',
      [
        'resetting the password from an emailed link',
        'confirming a new sign-in address from an emailed link',
      ],
    ],
    // "How I sign in changed."
    [
      'lib/auth/security/service.ts',
      'revokeSecuritySessions',
      [
        'turning the authenticator on',
        'turning the authenticator off, or replacing its recovery codes',
      ],
    ],
    [
      'lib/auth/security/passkeys.ts',
      'revokeSecuritySessions',
      ['adding a passkey', 'removing a passkey'],
    ],
    [
      'lib/auth/security/required-passkeys.ts',
      'revokeSecuritySessions',
      [
        'requiring passkeys, or no longer requiring them',
        'replacing passkey recovery codes',
      ],
    ],
    // The two helpers the actions above call, which carry the change.
    [
      'lib/auth/security/service.ts',
      'sessionRevocation',
      ['revokeSecuritySessions itself'],
    ],
    [
      'lib/users/credentials.ts',
      'sessionRevocation',
      ['changeCredentials itself'],
    ],
  ]

  const repo = process.cwd()
  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(join(directory, entry.name))
        : /\.tsx?$/.test(entry.name)
          ? [join(directory, entry.name)]
          : []
    )
  const files = ['app', 'lib', 'components', 'hooks'].flatMap((directory) =>
    sources(resolve(repo, directory))
  )
  /** Calls of a function in the app's own code, as `file function` once per call. */
  function callsOf(...names: string[]): string[] {
    const call = new RegExp(`\\b(${names.join('|')})\\(`, 'g')
    return files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        // A definition is not a call.
        .filter((line) => !/^export (async )?function /.test(line))
        .flatMap((line) =>
          [...line.matchAll(call)].map(
            ([, name]) => `${relative(repo, file)} ${name}`
          )
        )
    )
  }

  it('is named here: no other place signs an account out everywhere', () => {
    const expected = CALLERS.flatMap(([file, calls, actions]) =>
      actions.map(() => `${file} ${calls}`)
    )
    expect(
      callsOf(
        'revokeSecuritySessions',
        'sessionRevocation',
        'changeCredentials'
      ).sort(),
      'A new caller ends agents too: name what it does here and in the comment on sessionRevocation, and add it to the database suite'
    ).toEqual(expected.sort())
  })

  it('has one place that moves the session version on, and it ends the agents first', () => {
    const bumps = files.filter((file) =>
      /sessionVersion:\s*\{\s*increment/.test(readFileSync(file, 'utf8'))
    )
    expect(bumps.map((file) => relative(repo, file))).toEqual([
      'lib/auth/security/service.ts',
    ])
    const source = readFileSync(bumps[0], 'utf8')
    const body = source.slice(
      source.indexOf('export async function sessionRevocation('),
      source.indexOf('export async function revokeSecuritySessions(')
    )
    expect(body.indexOf('revokeAccountConnections(tx, userId')).toBeGreaterThan(
      0
    )
    expect(body.indexOf('revokeAccountConnections(tx, userId')).toBeLessThan(
      body.indexOf('sessionVersion: { increment: 1 }')
    )
  })

  it('says at the hook which actions those are, and why', () => {
    const source = readFileSync(
      resolve(repo, 'lib/auth/security/service.ts'),
      'utf8'
    )
    const start = source.indexOf('export async function sessionRevocation(')
    // The comment as running text, however its lines are broken.
    const comment = source
      .slice(source.lastIndexOf('/**', start), start)
      .replace(/\n \*/g, ' ')
      .replace(/\s+/g, ' ')
    for (const phrase of [
      '"I may be compromised"',
      '"How I sign in changed"',
      'signing out everywhere',
      'an administrator signing the account out',
      'a new password',
      'reset from an emailed link',
      'a new sign-in address',
      'turning the authenticator on or off',
      'replacing its recovery codes',
      'adding or removing a passkey',
      'requiring passkeys or no longer requiring them',
      'replacing passkey recovery codes',
      'Signing out one session, renaming a passkey and losing a role permission end no agent',
    ])
      expect(comment, phrase).toContain(phrase)
    expect(comment).not.toMatch(/[\u2013\u2014]/)
  })
})

describe("a connection's row lock", () => {
  const locked = async (lock: typeof lockConnection) => {
    const $queryRaw = vi.fn(async () => [])
    await lock({ $queryRaw } as never, 'c1')
    const [statement, ...values] = $queryRaw.mock.calls[0] as unknown as [
      string[],
      ...unknown[],
    ]
    return { sql: statement.join('?'), values }
  }

  it('is exclusive for whoever changes the connection', async () => {
    expect(await locked(lockConnection)).toEqual({
      sql: 'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR UPDATE',
      values: ['c1'],
    })
  })

  it('is shared by uploads that only need it to stay as it is', async () => {
    expect(await locked(holdConnection)).toEqual({
      sql: 'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR SHARE',
      values: ['c1'],
    })
  })

  it('has its order written beside it: the account, the connection, then its pairs and URLs', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/oauth/connections.ts'),
      'utf8'
    )
    const note = source
      .slice(
        source.indexOf('// The row locks of agent sign-in'),
        source.indexOf('type RowTx')
      )
      .replace(/\n\/\/ ?/g, ' ')
      .replace(/\s+/g, ' ')
    expect(note).toContain("1. The account's row (`lockUserRow`)")
    expect(note).toContain(
      "2. The connection's row (`lockConnection`, `holdConnection`)"
    )
    expect(note).toContain('3. Its token pairs and transfer URLs.')
    expect(note).toContain(
      "nothing that holds a connection's row asks for an account's row"
    )
  })
})

describe('whether a connection still holds what an upload needs', () => {
  const tx = (row: unknown) =>
    ({
      $queryRaw: vi.fn(async () => []),
      agentConnection: { findUnique: vi.fn(async () => row) },
    }) as never

  it("holds the connection's row before it reads it, so the answer stays true to the commit", async () => {
    const $queryRaw = vi.fn(async () => [])
    const findUnique = vi.fn(async () => ({
      revokedAt: null,
      scopes: ['files:upload'],
    }))
    expect(
      await connectionHolds(
        { $queryRaw, agentConnection: { findUnique } } as never,
        'c1',
        ['files:upload']
      )
    ).toBe(true)
    const [statement, id] = $queryRaw.mock.calls[0] as unknown as [
      string[],
      string,
    ]
    expect(statement.join('?')).toBe(
      'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR SHARE'
    )
    expect(id).toBe('c1')
    expect($queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0]
    )
  })

  it.each([
    [
      { revokedAt: null, scopes: ['files:upload', 'files:read'] },
      ['files:upload'],
      true,
    ],
    [{ revokedAt: null, scopes: ['files:upload'] }, [], true],
    [{ revokedAt: null, scopes: ['files:read'] }, ['files:upload'], false],
    [
      { revokedAt: null, scopes: ['files:upload'] },
      ['files:upload', 'files:read'],
      false,
    ],
    [
      { revokedAt: new Date(), scopes: ['files:upload'] },
      ['files:upload'],
      false,
    ],
    [{ revokedAt: new Date(0), scopes: ['files:upload'] }, [], false],
    [null, ['files:upload'], false],
    [null, [], false],
  ])('for %j needing %j: %s', async (row, scopes, expected) => {
    expect(await connectionHolds(tx(row), 'c1', scopes)).toBe(expected)
  })
})
