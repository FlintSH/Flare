import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditContext, auditContext } from '@/lib/audit/context'
import { DEFAULT_CONFIG } from '@/lib/config'
import { loggers } from '@/lib/logger'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import { TOOL_CATALOG, type ToolName } from '@/lib/mcp/catalog'
import { credentialHolds } from '@/lib/mcp/publish-check'
import {
  ADMIN_WRITES_PER_MINUTE,
  type McpRequestExtra,
  mcpHandler,
} from '@/lib/mcp/server'
import type { ToolContext, ToolDefinition } from '@/lib/mcp/tool'
import { hasPermission } from '@/lib/permissions/catalog'
import { PermissionError } from '@/lib/permissions/server'

// The server's own rules, around stand-in tools: whether a call reaches
// `run`, in which mode, with which arguments, and what it is told when not.
const runs = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown; context: ToolContext }[],
  /** Calls that got past every check and wrote. */
  writes: [] as string[],
  /** Holds a call marked `slow` inside the tool until it is opened. */
  gate: null as null | { started: () => void; open: Promise<void> },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
// A refusal is worded from the credential alone; the settings are never read.
vi.mock('@/lib/mcp/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/settings')>()),
  administrationOn: async () => {
    throw new Error('The server read the administration setting')
  },
}))
// One row that a scope of its own and an effect both make an administration
// write, which no real row is yet.
vi.mock('@/lib/mcp/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/catalog')>()
  const catalog = structuredClone(actual.TOOL_CATALOG) as Record<
    string,
    { effects?: Record<string, unknown> }
  >
  catalog.update_user.effects = {
    ...catalog.update_user.effects,
    also_admin: { scopes: ['admin:users'], permissions: [] },
  }
  return { ...actual, TOOL_CATALOG: catalog }
})
vi.mock('@/lib/mcp/tools', async () => {
  const z = await import('zod')
  const tool = (
    name: string,
    {
      strict,
      effects = [],
      ...extra
    }: { moderation?: true; strict?: true; effects?: string[] } = {}
  ): ToolDefinition => ({
    name: name as ToolName,
    description: `Stands in for ${name}.`,
    input: strict
      ? z.object({ query: z.string().optional() }).strict()
      : z.object({ query: z.string().optional() }),
    output: z.object({ ok: z.boolean() }),
    ...extra,
    async run(args, context) {
      runs.calls.push({ name, args, context })
      const query = (args as { query?: string }).query ?? ''
      // Asked for twice, as a tool may: the call still counts once.
      if (query === 'effects')
        for (const effect of [...effects, ...effects])
          context.requireEffect(effect)
      if (query.startsWith('slow:') && runs.gate) {
        runs.gate.started()
        await runs.gate.open
      }
      // `effect:<name>` or `slow:<name>` asks for that one effect.
      const one = /^(?:effect|slow):(.+)$/.exec(query)?.[1]
      if (one) context.requireEffect(one)
      // Access passed, and then the service under the tool fails.
      if (query === 'fail') throw new Error('The service failed')
      // The service finds that the account's role may not do this.
      if (query === 'forbidden')
        throw new PermissionError(
          'You cannot manage a user at or above your highest role'
        )
      // A refusal of the service that is not about the caller's access.
      if (query === 'conflict')
        throw new PermissionError(
          'Keep at least one administrator who can sign in',
          409
        )
      runs.writes.push(name)
      return { structured: { ok: true } }
    },
  })
  return {
    TOOLS: [
      tool('search_files', { moderation: true }),
      tool('delete_files', { moderation: true }),
      // Its row has moderation needs; this definition does not take them up.
      tool('list_short_links'),
      tool('create_short_link'),
      tool('list_users'),
      tool('update_user', { effects: ['also_admin'] }),
      tool('create_invite', { effects: ['roles'] }),
      tool('upload_file'),
      tool('move_files'),
      // A tool whose own schema refuses unknown arguments.
      tool('tag_files', { strict: true }),
      tool('set_file_expiry'),
    ],
  }
})

const ENDPOINT = 'https://flare.test/api/mcp'

function principal(
  scopes: string[],
  permissions: readonly string[],
  {
    userId = `user-${randomUUID()}`,
    credentialKey = `token:${randomUUID()}`,
  } = {}
): AgentPrincipal {
  return {
    user: {
      id: userId,
      storageUsed: 0,
      urlId: 'alex',
      vanityId: null,
      permissions: [...permissions] as never,
      roles: [],
      randomizeFileUrls: true,
      credential: 'token',
      apiToken: { id: 't1', scopes: [...scopes, 'mcp'], profileId: null },
    },
    name: 'Alex',
    scopes,
    credentialKey,
    can: (permission) => hasPermission({ permissions }, permission),
  }
}

type Listed = {
  name: string
  inputSchema: { properties?: Record<string, unknown>; required?: string[] }
}

async function rpc(
  who: AgentPrincipal,
  method: string,
  params?: Record<string, unknown>
) {
  const calling =
    method === 'tools/call' && Object.hasOwn(TOOL_CATALOG, String(params?.name))
      ? (params!.name as ToolName)
      : null
  const response = await mcpHandler().fetch(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    {
      authInfo: {
        token: '',
        clientId: who.credentialKey,
        scopes: [...who.scopes],
        extra: { principal: who, calling } satisfies McpRequestExtra,
      },
    }
  )
  const text = await response.text()
  return JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text) as {
    result?: {
      tools?: Listed[]
      isError?: boolean
      content?: { text?: string }[]
    }
    error?: { message: string }
  }
}

async function call(
  who: AgentPrincipal,
  name: string,
  args: Record<string, unknown> = {}
) {
  const context: AuditContext = {}
  const answer = await auditContext.run(context, () =>
    rpc(who, 'tools/call', { name, arguments: args })
  )
  return {
    refused: answer.result?.isError === true || Boolean(answer.error),
    text:
      answer.error?.message ??
      (answer.result?.content ?? []).map(({ text }) => text).join('\n'),
    outcome: context.outcome,
  }
}

const listed = async (who: AgentPrincipal) =>
  (await rpc(who, 'tools/list')).result?.tools ?? []

const OWNER = ['files:read', 'files:delete', 'urls:read', 'urls:write']
const OWNER_PERMISSIONS = [
  'files.read',
  'files.delete',
  'links.read',
  'links.create',
]
const MODERATOR = ['admin:content']
const MODERATOR_PERMISSIONS = ['content.read', 'content.delete']

beforeEach(() => {
  runs.calls.length = 0
  runs.writes.length = 0
})

describe('the account argument in a listed schema', () => {
  const schemaOf = async (who: AgentPrincipal, name: string) =>
    (await listed(who)).find((tool) => tool.name === name)?.inputSchema

  it('is not there for a connection that may only act on its own account', async () => {
    const schema = await schemaOf(
      principal(OWNER, OWNER_PERMISSIONS),
      'search_files'
    )
    expect(schema?.properties).not.toHaveProperty('account')
  })

  it('is there, optional, for a connection that may do both', async () => {
    const schema = await schemaOf(
      principal(
        [...OWNER, ...MODERATOR],
        [...OWNER_PERMISSIONS, ...MODERATOR_PERMISSIONS]
      ),
      'search_files'
    )
    expect(schema?.properties).toHaveProperty('account')
    expect(schema?.required ?? []).not.toContain('account')
  })

  it('is required where the connection may only moderate, and the tool is listed for it', async () => {
    const who = principal(MODERATOR, MODERATOR_PERMISSIONS)
    const tools = await listed(who)
    expect(tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['search_files', 'delete_files'])
    )
    const schema = tools.find(
      (tool) => tool.name === 'search_files'
    )?.inputSchema
    expect(schema?.required).toContain('account')
  })

  it('is not there, and the tool not listed, without the moderation permission', async () => {
    const who = principal(MODERATOR, ['users.read'])
    expect((await listed(who)).map(({ name }) => name)).not.toContain(
      'search_files'
    )
  })

  it('is never offered by a tool that does not take it up, even to a moderator', async () => {
    const who = principal(
      [...OWNER, ...MODERATOR],
      [...OWNER_PERMISSIONS, ...MODERATOR_PERMISSIONS]
    )
    const schema = await schemaOf(who, 'list_short_links')
    expect(schema?.properties).not.toHaveProperty('account')
    // Listed for what the connection may do with its own links, no more.
    expect(
      (await listed(principal(MODERATOR, MODERATOR_PERMISSIONS))).map(
        ({ name }) => name
      )
    ).not.toContain('list_short_links')
  })
})

describe('the mode a call chooses', () => {
  it('runs in owner mode without an account, with the arguments as given', async () => {
    const who = principal(
      [...OWNER, ...MODERATOR],
      [...OWNER_PERMISSIONS, ...MODERATOR_PERMISSIONS]
    )
    expect((await call(who, 'search_files', { query: 'report' })).refused).toBe(
      false
    )
    const [{ args, context }] = runs.calls
    expect(args).toEqual({ query: 'report' })
    expect(context.moderating).toBeNull()
    expect(context.mayModerate).toBe(true)
  })

  it('runs in moderator mode with an account, which it takes out of the arguments', async () => {
    const who = principal(MODERATOR, MODERATOR_PERMISSIONS)
    const answer = await call(who, 'search_files', {
      query: 'report',
      account: 'sam@example.com',
    })
    expect(answer.refused).toBe(false)
    const [{ args, context }] = runs.calls
    expect(args).toEqual({ query: 'report' })
    expect(context.moderating).toBe('sam@example.com')
    // The owner's needs do not apply: this connection has none of them.
    expect(context.mayModerate).toBe(true)
    expect(() => context.requireModeration()).not.toThrow()
  })

  it('checks the moderation needs, whatever schema the client holds', async () => {
    // A client that kept a schema with `account` after losing the right.
    const who = principal(OWNER, OWNER_PERMISSIONS)
    const answer = await call(who, 'delete_files', { account: 'sam' })
    expect(answer.refused).toBe(true)
    expect(answer.text).toBe(
      'Not allowed on another account\'s content: this connection was not granted "Moderate content" (admin:content). If administration through MCP is off, an administrator must first turn it on in Settings; then the account owner can create a new token that carries it in Flare under Profile, Integrations, since an existing token cannot be given it; and the account\'s role does not hold content.delete. An administrator can change that under Roles.'
    )
    expect(answer.outcome).toBe('denied')
    expect(runs.calls).toEqual([])
  })

  it('checks the moderation permission that matches the tool', async () => {
    // Reading other accounts' files is not deleting them.
    const reader = principal(MODERATOR, ['content.read'])
    expect(
      (await call(reader, 'search_files', { account: 'sam' })).refused
    ).toBe(false)
    const answer = await call(reader, 'delete_files', { account: 'sam' })
    expect(answer.refused).toBe(true)
    expect(answer.text).toContain('does not hold content.delete')
    expect(runs.calls.map(({ name }) => name)).toEqual(['search_files'])
  })

  it('checks the owner needs in owner mode, even for a connection that may moderate', async () => {
    const who = principal(MODERATOR, MODERATOR_PERMISSIONS)
    const answer = await call(who, 'search_files', { query: 'x' })
    expect(answer.refused).toBe(true)
    expect(answer.text).toMatch(
      /^Not allowed: this connection was not granted "Read files"/
    )
    expect(runs.calls).toEqual([])
  })

  it('refuses an account for a tool that does not act on other accounts yet, instead of running it as the owner', async () => {
    const who = principal(
      [...OWNER, ...MODERATOR],
      [...OWNER_PERMISSIONS, ...MODERATOR_PERMISSIONS]
    )
    const answer = await call(who, 'list_short_links', { account: 'sam' })
    expect(answer.refused).toBe(true)
    expect(answer.text).toBe(
      'list_short_links cannot act on another account\'s content on this Flare instance. Call it without "account".'
    )
    expect(answer.outcome).toBe('denied')
    expect(runs.calls).toEqual([])
  })

  describe('on a tool that acts only on its own account', () => {
    const everything = principal(
      [
        ...OWNER,
        ...MODERATOR,
        'files:upload',
        'files:organize',
        'admin:read',
        'admin:users',
      ],
      [
        ...OWNER_PERMISSIONS,
        ...MODERATOR_PERMISSIONS,
        'files.upload',
        'files.update',
        'folders.manage',
        'tags.manage',
        'files.expiration',
        'users.read',
        'users.update',
      ]
    )
    const refusal = (name: string) =>
      `${name} acts only on this connection's own account and takes no "account". Call it without "account". The tools that can act on another account's content take "account" in their schemas.`

    it.each([
      'move_files',
      'tag_files',
      'set_file_expiry',
      'create_short_link',
      'upload_file',
      'list_users',
      'update_user',
    ])('refuses account on %s in words, and runs nothing', async (name) => {
      const answer = await call(everything, name, {
        query: 'x',
        account: 'sam',
      })
      expect(answer.refused).toBe(true)
      expect(answer.text).toBe(refusal(name))
      expect(answer.outcome).toBe('denied')
      expect(runs.calls).toEqual([])
      // Without it, the same call runs.
      expect((await call(everything, name, { query: 'x' })).refused).toBe(false)
    })

    it('refuses it the same way whether or not the tool schema is strict', async () => {
      const strict = await call(everything, 'tag_files', { account: 'sam' })
      const loose = await call(everything, 'move_files', { account: 'sam' })
      expect(strict.text).toBe(refusal('tag_files'))
      expect(loose.text).toBe(refusal('move_files'))
      expect(runs.calls).toEqual([])
    })

    it('refuses it even for a connection that may not call the tool at all', async () => {
      const answer = await call(principal([], []), 'move_files', {
        account: 'sam',
      })
      expect(answer.text).toBe(refusal('move_files'))
      expect(runs.calls).toEqual([])
    })
  })

  it('treats an empty account as no account named at all, never as the caller', async () => {
    const who = principal(MODERATOR, MODERATOR_PERMISSIONS)
    const answer = await call(who, 'search_files', { account: '   ' })
    expect(answer.refused).toBe(true)
    expect(runs.calls).toEqual([])
  })

  it('tells a tool in owner mode why it may not moderate, in words', async () => {
    const who = principal(OWNER, OWNER_PERMISSIONS)
    await call(who, 'search_files')
    const [{ context }] = runs.calls
    expect(context.mayModerate).toBe(false)
    expect(() => context.requireModeration()).toThrow(
      /^Not allowed on another account's content: this connection was not granted "Moderate content" \(admin:content\)/
    )
  })

  it('keeps effects for owner mode: asking for one while moderating is a bug', async () => {
    const who = principal(MODERATOR, MODERATOR_PERMISSIONS)
    await call(who, 'search_files', { account: 'sam' })
    const [{ context }] = runs.calls
    expect(() => context.allows('anything')).toThrow(/moderator mode/)
    expect(() => context.requireEffect('anything')).toThrow(/moderator mode/)
  })
})

describe('refusals of administration tools', () => {
  it('names the alternatives when the role holds none of them', async () => {
    const answer = await call(
      principal(['admin:users'], ['users.read']),
      'update_user'
    )
    expect(answer.text).toBe(
      "Not allowed: the account's role holds none of users.update, users.roles, users.email, users.sessions. An administrator can change that under Roles."
    )
    expect(answer.outcome).toBe('denied')
  })

  it('runs with any one of the alternatives', async () => {
    for (const permission of [
      'users.update',
      'users.roles',
      'users.email',
      'users.sessions',
    ])
      expect(
        (await call(principal(['admin:users'], [permission]), 'update_user'))
          .refused,
        permission
      ).toBe(false)
  })

  describe('for a missing administration scope', () => {
    const TOKEN_GRANT =
      'the account owner can create a new token that carries it in Flare under Profile, Integrations, since an existing token cannot be given it'
    const SIGN_IN_GRANT =
      'sign in to Flare again from your client and have the account owner tick it when asked, since an existing connection cannot be given it'
    const MISSING =
      'Not allowed: this connection was not granted "View administration" (admin:read).'
    /** An agent that signed in through the browser, with no token. */
    const connected = (scopes: string[], permissions: string[]) => {
      const who = principal(scopes, permissions)
      delete who.user.apiToken
      who.user.credential = 'agent'
      who.user.agentConnection = { id: 'c1', scopes }
      return who
    }

    const MAYBE_OFF =
      'If administration through MCP is off, an administrator must first turn it on in Settings; then'

    it.each<[string, () => AgentPrincipal, string]>([
      [
        'tells a token that holds another administration scope to be replaced by one that carries it',
        () => principal(['admin:users'], ['users.read']),
        `${MISSING} To grant it, ${TOKEN_GRANT}.`,
      ],
      [
        'tells a token that holds none to have administration turned on first, if it is off',
        () => principal([], ['users.read']),
        `${MISSING} ${MAYBE_OFF} ${TOKEN_GRANT}.`,
      ],
      [
        'tells a signed-in agent that holds another administration scope to sign in again',
        () => connected(['admin:users'], ['users.read']),
        `${MISSING} To grant it, ${SIGN_IN_GRANT}.`,
      ],
      [
        'tells a signed-in agent that holds none to have administration turned on first, if it is off',
        () => connected([], ['users.read']),
        `${MISSING} ${MAYBE_OFF} ${SIGN_IN_GRANT}.`,
      ],
    ])('%s', async (_what, who, text) => {
      const answer = await call(who(), 'list_users')
      expect(answer.text).toBe(text)
      expect(answer.outcome).toBe('denied')
      expect(runs.calls).toEqual([])
    })

    it('words an effect that needs one the same way', async () => {
      const answer = await call(
        principal(['invites:write'], ['invites.create', 'users.roles']),
        'create_invite',
        { query: 'effects' }
      )
      expect(answer.text).toBe(
        `Not allowed: this connection was not granted "Manage users and roles" (admin:users). ${MAYBE_OFF} ${TOKEN_GRANT}.`
      )
      const holding = await call(
        principal(
          ['invites:write', 'admin:read'],
          ['invites.create', 'users.roles']
        ),
        'create_invite',
        { query: 'effects' }
      )
      expect(holding.text).toBe(
        `Not allowed: this connection was not granted "Manage users and roles" (admin:users). To grant it, ${TOKEN_GRANT}.`
      )
      expect(runs.writes).toEqual([])
    })

    it('leaves the advice for every other scope as it was', async () => {
      const answer = await call(principal([], ['files.read']), 'search_files')
      expect(answer.text).toBe(
        'Not allowed: this connection was not granted "Read files" (files:read). The account owner can allow it in Flare under Profile, Integrations.'
      )
    })
  })
})

describe('the administration write limit', () => {
  const inviter = (userId: string, scopes = ['invites:write', 'admin:users']) =>
    principal(scopes, ['invites.create', 'users.roles'], { userId })
  const LIMITED = `Too many administration changes: an account may make ${ADMIN_WRITES_PER_MINUTE} a minute through MCP, across all its connections. Wait a minute, then continue.`

  it('counts an invite that grants roles, once each, and refuses the next before it writes', async () => {
    const who = inviter(`user-${randomUUID()}`)
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(who, 'create_invite', { query: 'effects' })
      if (answer.refused)
        throw new Error(`Invite ${made + 1} was refused: ${answer.text}`)
    }
    expect(runs.writes).toHaveLength(ADMIN_WRITES_PER_MINUTE)
    const answer = await call(who, 'create_invite', { query: 'effects' })
    expect(answer.text).toBe(LIMITED)
    expect(answer.outcome).toBe('denied')
    // It reached the tool, which wrote nothing.
    expect(runs.writes).toHaveLength(ADMIN_WRITES_PER_MINUTE)
    // An invite without roles is not an administration write.
    expect((await call(who, 'create_invite')).refused).toBe(false)
  })

  it('does not count an invite without roles', async () => {
    const who = inviter(`user-${randomUUID()}`)
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE + 5; made++)
      expect((await call(who, 'create_invite')).refused).toBe(false)
    expect(
      (await call(who, 'create_invite', { query: 'effects' })).refused
    ).toBe(false)
  })

  it('costs nothing for an invite with roles refused for missing access', async () => {
    const userId = `user-${randomUUID()}`
    const lacking = inviter(userId, ['invites:write'])
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE + 5; made++)
      expect(
        (await call(lacking, 'create_invite', { query: 'effects' })).refused
      ).toBe(true)
    const who = inviter(userId)
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++)
      expect(
        (await call(who, 'create_invite', { query: 'effects' })).refused
      ).toBe(false)
  })

  const updater = (userId: string) =>
    principal(['admin:users'], ['users.update'], { userId })

  it('gives the allowance back to a call refused for a missing effect, after its own scope counted it', async () => {
    // users.update but not users.sessions: signing out is refused.
    const who = updater(`user-${randomUUID()}`)
    for (let made = 0; made < 40; made++) {
      const answer = await call(who, 'update_user', {
        query: 'effect:sign_out',
      })
      expect(answer.text).toMatch(/does not hold users.sessions/)
      expect(answer.outcome).toBe('denied')
    }
    expect(runs.writes).toEqual([])
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(who, 'update_user')
      if (answer.refused)
        throw new Error(`Write ${made + 1} was refused: ${answer.text}`)
    }
    expect((await call(who, 'update_user')).text).toBe(LIMITED)
  })

  it('gives the allowance back to a call the service refused for the role, such as an account above it', async () => {
    const who = updater(`user-${randomUUID()}`)
    for (let made = 0; made < 40; made++) {
      const answer = await call(who, 'update_user', { query: 'forbidden' })
      expect(answer.text).toBe(
        'You cannot manage a user at or above your highest role'
      )
      expect(answer.outcome).toBe('denied')
    }
    expect(runs.writes).toEqual([])
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(who, 'update_user')
      if (answer.refused)
        throw new Error(`Write ${made + 1} was refused: ${answer.text}`)
    }
    expect((await call(who, 'update_user')).text).toBe(LIMITED)
  })

  it('keeps the cost of a service refusal that is not about access', async () => {
    const who = updater(`user-${randomUUID()}`)
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(who, 'update_user', { query: 'conflict' })
      expect(answer.text).toBe(
        'Keep at least one administrator who can sign in'
      )
    }
    expect((await call(who, 'update_user')).text).toBe(LIMITED)
  })

  it('keeps the cost of a call that passed access and then failed', async () => {
    // The failure is logged, as any unexpected one is.
    const logged = vi
      .spyOn(loggers.api, 'error')
      .mockImplementation(() => loggers.api)
    const who = updater(`user-${randomUUID()}`)
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(who, 'update_user', { query: 'fail' })
      expect(answer.refused).toBe(true)
      expect(answer.outcome).toBe('failure')
    }
    expect((await call(who, 'update_user')).text).toBe(LIMITED)
    // The limit's own refusal gives nothing back either.
    expect((await call(who, 'update_user')).text).toBe(LIMITED)
    expect(logged).toHaveBeenCalledTimes(ADMIN_WRITES_PER_MINUTE)
    logged.mockRestore()
  })

  it('gives back nothing into a minute that started after the call was counted', async () => {
    const userId = `user-${randomUUID()}`
    const who = updater(userId)
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      let started = () => {}
      let open = () => {}
      const reached = new Promise<void>((resolve) => (started = resolve))
      runs.gate = {
        started,
        open: new Promise<void>((resolve) => (open = resolve)),
      }
      // Counted in this minute, then held inside the tool.
      const slow = call(who, 'update_user', { query: 'slow:sign_out' })
      await reached
      now += 61_000
      // The next minute fills up meanwhile.
      for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++)
        expect((await call(who, 'update_user')).refused).toBe(false)
      open()
      expect((await slow).text).toMatch(/does not hold users.sessions/)
      // Its refund belonged to the old minute: the new one is still full.
      expect((await call(who, 'update_user')).text).toBe(LIMITED)
    } finally {
      runs.gate = null
      vi.restoreAllMocks()
    }
  })

  it('counts a call once when both its own scope and an effect are administration', async () => {
    const who = principal(['admin:users'], ['users.update'], {
      userId: `user-${randomUUID()}`,
    })
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(who, 'update_user', { query: 'effects' })
      if (answer.refused)
        throw new Error(`Write ${made + 1} was refused: ${answer.text}`)
    }
    const answer = await call(who, 'update_user', { query: 'effects' })
    expect(answer.text).toBe(LIMITED)
    // Refused before the tool ran: its own scope counts before `run`.
    expect(runs.writes).toHaveLength(ADMIN_WRITES_PER_MINUTE)
  })

  it(`is ${ADMIN_WRITES_PER_MINUTE} a minute`, () => {
    expect(ADMIN_WRITES_PER_MINUTE).toBe(30)
  })

  it('counts writes per account across its connections, and refuses the 31st', async () => {
    const userId = `user-${randomUUID()}`
    const first = principal(['admin:users'], ['users.update'], { userId })
    const second = principal(['admin:users'], ['users.update'], { userId })
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++) {
      const answer = await call(made % 2 ? first : second, 'update_user')
      if (answer.refused)
        throw new Error(`Write ${made + 1} was refused: ${answer.text}`)
    }
    const refused = await call(first, 'update_user')
    expect(refused.refused).toBe(true)
    expect(refused.text).toBe(
      'Too many administration changes: an account may make 30 a minute through MCP, across all its connections. Wait a minute, then continue.'
    )
    expect(refused.outcome).toBe('denied')
    expect(runs.calls).toHaveLength(ADMIN_WRITES_PER_MINUTE)
    // Another account has its own allowance.
    expect(
      (await call(principal(['admin:users'], ['users.update']), 'update_user'))
        .refused
    ).toBe(false)
  })

  it('counts moderator-mode writes, and the limit covers them and administration tools together', async () => {
    const userId = `user-${randomUUID()}`
    const moderator = principal(
      ['admin:content', 'admin:users'],
      ['content.delete', 'users.update'],
      { userId }
    )
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE; made++)
      expect(
        (await call(moderator, 'delete_files', { account: 'sam' })).refused
      ).toBe(false)
    expect((await call(moderator, 'update_user')).text).toMatch(
      /^Too many administration changes/
    )
  })

  it('does not count reads, writes to the account itself, or refused calls', async () => {
    const userId = `user-${randomUUID()}`
    for (let made = 0; made < ADMIN_WRITES_PER_MINUTE + 5; made++) {
      // A connection of its own each time, so its own limit never applies.
      const who = principal(
        [
          'admin:read',
          'admin:content',
          'admin:users',
          'urls:write',
          'files:delete',
        ],
        ['users.read', 'content.read', 'links.create', 'files.delete'],
        { userId }
      )
      await call(who, 'list_users')
      await call(who, 'search_files', { account: 'sam' })
      await call(who, 'create_short_link')
      await call(who, 'delete_files')
      // Refused before the limit: the role holds no user permission.
      await call(who, 'update_user')
    }
    expect(
      (
        await call(
          principal(['admin:users'], ['users.update'], { userId }),
          'update_user'
        )
      ).refused
    ).toBe(false)
  })
})

describe("the last check before an agent's work takes effect", () => {
  const DAY = 86_400_000
  /** A transaction that holds one connection and the saved settings. */
  const transaction = (
    connection: { scopes: string[]; createdAt: Date },
    administration: boolean
  ) => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp = { enabled: true, administration }
    return {
      $queryRaw: vi.fn(async () => []),
      agentConnection: {
        findUnique: vi.fn(async () => ({ revokedAt: null, ...connection })),
      },
      config: { findUnique: vi.fn(async () => ({ value: config })) },
    } as unknown as Prisma.TransactionClient
  }
  const signedIn = (scopes: string[]) => {
    const who = principal(scopes, ['users.read'])
    who.user.apiToken = undefined
    who.user.agentConnection = { id: 'connection-1', scopes }
    return who
  }

  it('holds an administration scope only while administration is on', async () => {
    const who = signedIn(['admin:read'])
    const fresh = { scopes: ['admin:read'], createdAt: new Date() }
    expect(
      await credentialHolds(transaction(fresh, true), who, ['admin:read'])
    ).toBe(true)
    expect(
      await credentialHolds(transaction(fresh, false), who, ['admin:read'])
    ).toBe(false)
    // Other scopes of the same connection do not depend on it.
    const both = { scopes: ['files:read', 'admin:read'], createdAt: new Date() }
    expect(
      await credentialHolds(transaction(both, false), who, ['files:read'])
    ).toBe(true)
  })

  it('holds nothing for a connection 30 days after it was granted an administration scope', async () => {
    const who = signedIn(['files:read', 'admin:read'])
    const old = {
      scopes: ['files:read', 'admin:read'],
      createdAt: new Date(Date.now() - 31 * DAY),
    }
    expect(
      await credentialHolds(transaction(old, true), who, ['files:read'])
    ).toBe(false)
    // One without such a scope lasts as long as its sign-in does.
    expect(
      await credentialHolds(
        transaction({ ...old, scopes: ['files:read'] }, true),
        who,
        ['files:read']
      )
    ).toBe(true)
  })
})
