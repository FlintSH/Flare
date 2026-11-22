import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG } from '@/lib/config'
import { HttpError } from '@/lib/http/errors'
import {
  IntegrationError,
  listIntegrations,
  runIntegrationCommand,
} from '@/lib/integrations/service'
import { WEBHOOK_SECRET_PURPOSE } from '@/lib/integrations/webhooks'
import { decryptSecret } from '@/lib/security/secret-box'

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  list: vi.fn(),
  connections: vi.fn(),
  mcpEnabled: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    // Row locks.
    $queryRaw: vi.fn(),
    apiToken: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    agentConnection: { updateMany: vi.fn() },
    agentToken: { deleteMany: vi.fn() },
    config: { findUnique: vi.fn() },
    uploadProfile: { findFirst: vi.fn() },
    webhook: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    webhookDelivery: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: db.transaction,
    apiToken: { findMany: db.list },
    webhook: { findMany: db.list },
    webhookDelivery: { findMany: db.list },
    uploadProfile: { findMany: db.list },
    agentConnection: { findMany: db.connections },
  },
}))
vi.mock('@/lib/mcp/settings', () => ({ mcpEnabled: db.mcpEnabled }))
vi.mock('@/lib/integrations/security', () => ({
  resolveWebhookTarget: vi.fn(async () => ({})),
}))

const owner = { id: 'owner', permissions: ['tokens.manage', 'webhooks.manage'] }
const commands = {
  'create-token': {
    action: 'create-token',
    name: 'Client',
    scopes: ['files:upload'],
  },
  'revoke-token': { action: 'revoke-token', id: 'token' },
  'create-webhook': {
    action: 'create-webhook',
    name: 'Receiver',
    url: 'https://hooks.example/flare',
  },
  'toggle-webhook': { action: 'toggle-webhook', id: 'hook', enabled: false },
  'delete-webhook': { action: 'delete-webhook', id: 'hook' },
  'test-webhook': { action: 'test-webhook', id: 'hook' },
  'retry-delivery': { action: 'retry-delivery', id: 'delivery' },
  'disconnect-agent': { action: 'disconnect-agent', id: 'connection' },
  'update-agent': {
    action: 'update-agent',
    id: 'connection',
    scopes: ['files:read'],
  },
}
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('Expected the command to be refused')
    },
    (error: unknown) => error as HttpError
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
  vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY_FILE', '')
  vi.stubEnv(
    'NEXTAUTH_SECRET',
    'test-secret-for-integrations-at-least-32-characters'
  )
  db.transaction.mockImplementation(
    (run: (tx: typeof db.tx) => Promise<unknown>) => run(db.tx)
  )
  db.tx.webhookDelivery.count.mockResolvedValue(0)
})
afterEach(() => vi.unstubAllEnvs())

describe('integration commands', () => {
  it.each([
    ['create-token', 'tokens.manage', 'webhooks.manage'],
    ['revoke-token', 'tokens.manage', 'webhooks.manage'],
    ['create-webhook', 'webhooks.manage', 'tokens.manage'],
    ['toggle-webhook', 'webhooks.manage', 'tokens.manage'],
    ['delete-webhook', 'webhooks.manage', 'tokens.manage'],
    ['test-webhook', 'webhooks.manage', 'tokens.manage'],
    ['retry-delivery', 'webhooks.manage', 'tokens.manage'],
    ['disconnect-agent', 'tokens.manage', 'webhooks.manage'],
    ['update-agent', 'tokens.manage', 'webhooks.manage'],
  ] as const)('%s needs %s', async (action, needed, other) => {
    const error = await refusal(
      runIntegrationCommand(
        { id: 'owner', permissions: [other] },
        commands[action]
      )
    )
    expect([error.status, error.message]).toEqual([
      403,
      'You do not have permission to perform this action.',
    ])
    expect(db.transaction).not.toHaveBeenCalled()
    db.transaction.mockResolvedValueOnce({ ok: true })
    await expect(
      runIntegrationCommand(
        { id: 'owner', permissions: [needed] },
        commands[action]
      )
    ).resolves.toEqual({ ok: true })
  })

  it('checks the command before the permission', async () => {
    const error = await refusal(
      runIntegrationCommand(
        { id: 'owner', permissions: [] },
        { action: 'create-token', name: '', scopes: [] }
      )
    )
    expect(error).not.toBeInstanceOf(IntegrationError)
    expect([error.status, error.message, error.headers]).toEqual([
      400,
      'Check the integration settings and try again.',
      {},
    ])
  })

  it('answers a refusal from saved integrations with an uncached 400', async () => {
    db.tx.webhook.findFirst.mockResolvedValue(null)
    const error = await refusal(
      runIntegrationCommand(owner, commands['delete-webhook'])
    )
    expect(error).toBeInstanceOf(IntegrationError)
    expect([error.status, error.message, error.headers]).toEqual([
      400,
      'Webhook not found.',
      { 'cache-control': 'no-store' },
    ])
    expect(db.tx.webhook.delete).not.toHaveBeenCalled()
  })

  it('binds a token only to one of the account’s profiles, with the upload scope', async () => {
    db.tx.apiToken.count.mockResolvedValue(0)
    db.tx.uploadProfile.findFirst.mockResolvedValue(null)
    for (const scopes of [['files:read'], ['files:upload']]) {
      const error = await refusal(
        runIntegrationCommand(owner, {
          ...commands['create-token'],
          scopes,
          profileId: 'foreign',
        })
      )
      expect(error).toBeInstanceOf(IntegrationError)
      expect([error.status, error.message, error.headers]).toEqual([
        400,
        'Choose one of your upload profiles and enable the upload scope.',
        { 'cache-control': 'no-store' },
      ])
    }
    expect(db.tx.uploadProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', userId: 'owner' },
    })
    expect(db.tx.apiToken.create).not.toHaveBeenCalled()
  })

  it('stores a new signing secret encrypted and returns it once', async () => {
    db.tx.webhook.count.mockResolvedValue(9)
    db.tx.webhook.create.mockResolvedValue({ id: 'hook' })
    const result = (await runIntegrationCommand(
      owner,
      commands['create-webhook']
    )) as { secret: string; secretKind: string }
    expect(result).toEqual({
      webhook: { id: 'hook' },
      secret: expect.stringMatching(/^whsec_[\w-]{43}$/),
      secretKind: 'webhook',
    })
    const stored = db.tx.webhook.create.mock.calls[0][0].data.secret
    expect(stored).not.toContain(result.secret)
    expect(decryptSecret(stored, WEBHOOK_SECRET_PURPOSE)).toBe(result.secret)
    db.tx.webhook.count.mockResolvedValue(10)
    expect(
      (await refusal(runIntegrationCommand(owner, commands['create-webhook'])))
        .message
    ).toBe('Delete an unused webhook before creating another (limit 10).')
  })

  it('queues a sample file-ready event for a test', async () => {
    db.tx.webhook.findFirst.mockResolvedValue({ id: 'hook', enabled: true })
    await expect(
      runIntegrationCommand(owner, commands['test-webhook'])
    ).resolves.toEqual({ ok: true })
    const { data } = db.tx.webhookDelivery.create.mock.calls[0][0]
    expect(data.webhookId).toBe('hook')
    expect(data.eventId).toBe(data.payload.id)
    expect(data.payload).toMatchObject({
      type: 'file.ready',
      test: true,
      data: { id: 'example-file' },
    })
  })

  it.each([
    [
      'test-webhook',
      () =>
        db.tx.webhook.findFirst.mockResolvedValue({
          id: 'hook',
          enabled: true,
        }),
    ],
    [
      'retry-delivery',
      () =>
        db.tx.webhookDelivery.findFirst.mockResolvedValue({
          id: 'delivery',
          webhookId: 'hook',
          updatedAt: new Date(0),
        }),
    ],
  ] as const)(
    'refuses %s while the account queue is full',
    async (action, arrange) => {
      arrange()
      db.tx.webhookDelivery.count.mockResolvedValueOnce(5000)
      expect(
        (await refusal(runIntegrationCommand(owner, commands[action]))).message
      ).toBe(
        'Webhook queue is full. Wait for pending deliveries or pause a stalled webhook.'
      )
      expect(db.tx.webhookDelivery.create).not.toHaveBeenCalled()
      expect(db.tx.webhookDelivery.update).not.toHaveBeenCalled()
    }
  )
})

describe('tokens for agents', () => {
  // A role that reads and uploads, and nothing else.
  const member = {
    id: 'owner',
    permissions: ['tokens.manage', 'files.read', 'files.upload', 'links.read'],
  }
  const create = (scopes: string[], account = member) =>
    runIntegrationCommand(account, { ...commands['create-token'], scopes })
  const mcp = (enabled: boolean) => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp.enabled = enabled
    db.tx.config.findUnique.mockResolvedValue({ value: config })
  }
  const stored = () => db.tx.apiToken.create.mock.calls[0][0].data.scopes

  beforeEach(() => {
    db.tx.apiToken.count.mockResolvedValue(0)
    db.tx.apiToken.create.mockResolvedValue({ id: 'token' })
  })

  it('creates a token of REST scopes as before, whatever the role and the switch', async () => {
    // Nothing saved yet: the MCP server is off by default.
    const result = await create(['files:upload', 'urls:write'], owner)
    expect(result).toEqual({
      token: { id: 'token' },
      secret: expect.stringMatching(/^flr_[\w-]{43}$/),
      secretKind: 'token',
    })
    expect(stored()).toEqual(['files:upload', 'urls:write'])
    expect(db.tx.config.findUnique).not.toHaveBeenCalled()
  })

  it('creates a token with Agent access and what the role can use', async () => {
    mcp(true)
    await expect(
      create([
        'mcp',
        'files:read',
        'files:content',
        'files:upload',
        'urls:read',
        'mcp',
      ])
    ).resolves.toMatchObject({ secretKind: 'token' })
    expect(stored()).toEqual([
      'mcp',
      'files:read',
      'files:content',
      'files:upload',
      'urls:read',
    ])
    // Agent access alone is enough to see the account.
    db.tx.apiToken.create.mockClear()
    await expect(create(['mcp'])).resolves.toMatchObject({
      secretKind: 'token',
    })
    expect(stored()).toEqual(['mcp'])
  })

  it.each([
    [['mcp']],
    [['mcp', 'files:read']],
    [['files:content']],
    [['files:read', 'files:delete']],
  ])('refuses %j while the MCP server is off', async (scopes) => {
    for (const saved of [false, null]) {
      if (saved === false) mcp(false)
      else db.tx.config.findUnique.mockResolvedValue(null)
      const error = await refusal(create(scopes))
      expect(error).toBeInstanceOf(IntegrationError)
      expect(error.message).toBe(
        'The MCP server is turned off on this instance, so tokens cannot have Agent access.'
      )
    }
    expect(db.tx.apiToken.create).not.toHaveBeenCalled()
  })

  it('refuses a scope only agents use on a token without Agent access', async () => {
    mcp(true)
    expect(
      (await refusal(create(['files:read', 'files:content']))).message
    ).toBe(
      'Agent access is needed for "Read file contents". Enable Agent access on the token, or remove it.'
    )
    expect(
      (await refusal(create(['files:organize', 'files:delete']))).message
    ).toBe(
      'Agent access is needed for "Organize files", "Delete files". Enable Agent access on the token, or remove them.'
    )
    expect(db.tx.apiToken.create).not.toHaveBeenCalled()
  })

  it('refuses what the role cannot use on a token for agents', async () => {
    mcp(true)
    // This role holds neither files.delete nor a links permission to write.
    expect((await refusal(create(['mcp', 'files:delete']))).message).toBe(
      'Your role does not allow "Delete files". Remove it and try again.'
    )
    expect(
      (
        await refusal(
          create(['mcp', 'files:read', 'files:share', 'urls:write'])
        )
      ).message
    ).toBe(
      'Your role does not allow "Change sharing", "Manage short links". Remove them and try again.'
    )
    expect(db.tx.apiToken.create).not.toHaveBeenCalled()
    // The same request passes once the role allows it.
    await expect(
      create(['mcp', 'files:delete'], {
        id: 'owner',
        permissions: ['tokens.manage', 'files.delete'],
      })
    ).resolves.toMatchObject({ secretKind: 'token' })
  })

  it('still rejects a scope that does not exist', async () => {
    const error = await refusal(create(['mcp', 'admin:everything']))
    expect([error.status, error.message]).toEqual([
      400,
      'Check the integration settings and try again.',
    ])
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('agents that signed in', () => {
  const mcp = (enabled: boolean) => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp.enabled = enabled
    db.tx.config.findUnique.mockResolvedValue({ value: config })
  }
  const reader = {
    id: 'owner',
    permissions: ['tokens.manage', 'files.read', 'files.upload', 'links.read'],
  }
  const update = (scopes: string[], account: typeof owner = reader) =>
    runIntegrationCommand(account, {
      action: 'update-agent',
      id: 'connection',
      scopes,
    })
  const saved = () => db.tx.agentConnection.updateMany.mock.calls[0][0]

  beforeEach(() => {
    mcp(true)
    db.tx.agentConnection.updateMany.mockResolvedValue({ count: 1 })
    db.tx.agentToken.deleteMany.mockResolvedValue({ count: 2 })
  })
  /** The credential of every statement that removed transfer URLs. */
  const transferDeletes = () =>
    db.tx.$executeRaw.mock.calls
      .filter(([statement]) =>
        (statement as string[]).join('?').includes('"AgentTransfer"')
      )
      .map(([, credential]) => credential)

  describe('disconnect-agent', () => {
    const disconnect = (id = 'connection', account = owner) =>
      runIntegrationCommand(account, { action: 'disconnect-agent', id })

    it("ends the account's own live connection, with its tokens and transfer URLs", async () => {
      await expect(disconnect()).resolves.toEqual({ ok: true })
      expect(db.tx.agentConnection.updateMany).toHaveBeenCalledExactlyOnceWith({
        // Its own, and only while it is live.
        where: { id: 'connection', userId: 'owner', revokedAt: null },
        data: { revokedAt: expect.any(Date), revokedReason: 'disconnected' },
      })
      expect(db.tx.agentToken.deleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { connectionId: 'connection' },
      })
      expect(transferDeletes()).toEqual(['connection:connection'])
    })

    it("takes the connection's row before ending it, so an upload publishing for it finishes first", async () => {
      await disconnect()
      const [statement, id] = db.tx.$queryRaw.mock.calls[0]
      expect(statement.join('?')).toBe(
        'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR UPDATE'
      )
      expect(id).toBe('connection')
      expect(db.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.tx.agentConnection.updateMany.mock.invocationCallOrder[0]
      )
    })

    it("refuses another account's connection, one already ended, and one that is not there", async () => {
      db.tx.agentConnection.updateMany.mockResolvedValue({ count: 0 })
      const error = await refusal(disconnect('someone-elses'))
      expect(error).toBeInstanceOf(IntegrationError)
      expect([error.status, error.message, error.headers]).toEqual([
        400,
        'Agent not found or already disconnected.',
        { 'cache-control': 'no-store' },
      ])
      // Nothing of a connection it did not end is touched.
      expect(db.tx.agentToken.deleteMany).not.toHaveBeenCalled()
      expect(transferDeletes()).toEqual([])
    })

    it('works while the MCP server is off: ending access never waits for a switch', async () => {
      mcp(false)
      await expect(disconnect()).resolves.toEqual({ ok: true })
      expect(db.tx.config.findUnique).not.toHaveBeenCalled()
    })

    it.each([
      [{ action: 'disconnect-agent' }],
      [{ action: 'disconnect-agent', id: '' }],
      [{ action: 'disconnect-agent', id: 'connection', userId: 'other' }],
      [{ action: 'disconnect-agent', id: ['connection'] }],
    ])('refuses the malformed command %j', async (command) => {
      const error = await refusal(runIntegrationCommand(owner, command))
      expect(error.message).toBe(
        'Check the integration settings and try again.'
      )
      expect(db.transaction).not.toHaveBeenCalled()
    })
  })

  describe('update-agent', () => {
    it('saves the new permissions on the live connection, in catalog order, each once', async () => {
      await expect(
        update(['urls:read', 'files:read', 'files:upload', 'files:read'])
      ).resolves.toEqual({ ok: true })
      expect(db.tx.agentConnection.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'connection', userId: 'owner', revokedAt: null },
        data: { scopes: ['files:upload', 'files:read', 'urls:read'] },
      })
      // Its tokens are left alone: what they can do is read from the connection.
      expect(db.tx.agentToken.deleteMany).not.toHaveBeenCalled()
    })

    it("takes the connection's row before editing it, so an upload publishing for it finishes first", async () => {
      await update(['files:read'])
      const [statement, id] = db.tx.$queryRaw.mock.calls[0]
      expect(statement.join('?')).toBe(
        'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR UPDATE'
      )
      expect(id).toBe('connection')
      expect(db.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.tx.agentConnection.updateMany.mock.invocationCallOrder[0]
      )
    })

    it('locks nothing for a change it refuses', async () => {
      await refusal(update(['files:read', 'files:delete']))
      await refusal(update(['mcp']))
      expect(db.tx.$queryRaw).not.toHaveBeenCalled()
    })

    it('can add a permission the sign-in did not ask for, when the role has it', async () => {
      await update(['files:read', 'files:content', 'files:upload'])
      expect(saved().data.scopes).toEqual([
        'files:upload',
        'files:read',
        'files:content',
      ])
    })

    it.each([[['mcp']], [['mcp', 'files:read']], [['files:read', 'mcp']]])(
      'never gives a connection the marker: %j',
      async (scopes) => {
        expect((await refusal(update(scopes))).message).toBe(
          'An agent that signed in cannot hold "Agent access". Remove it and try again.'
        )
        expect(db.tx.agentConnection.updateMany).not.toHaveBeenCalled()
      }
    )

    it("refuses what the account's role cannot use right now", async () => {
      expect(
        (await refusal(update(['files:read', 'files:delete']))).message
      ).toBe(
        'Your role does not allow "Delete files". Remove it and try again.'
      )
      expect(
        (await refusal(update(['files:share', 'urls:write', 'files:read'])))
          .message
      ).toBe(
        'Your role does not allow "Change sharing", "Manage short links". Remove them and try again.'
      )
      expect(db.tx.agentConnection.updateMany).not.toHaveBeenCalled()
      // The same request passes once the role allows it.
      await expect(
        update(['files:read', 'files:delete'], {
          id: 'owner',
          permissions: ['tokens.manage', 'files.read', 'files.delete'],
        })
      ).resolves.toEqual({ ok: true })
    })

    it('lets an administrator grant everything a sign-in can', async () => {
      await update(
        [
          'files:upload',
          'files:read',
          'files:content',
          'files:organize',
          'files:share',
          'files:delete',
          'urls:read',
          'urls:write',
        ],
        { id: 'owner', permissions: ['administrator'] }
      )
      expect(saved().data.scopes).toHaveLength(8)
    })

    it.each([
      [{ action: 'update-agent', id: 'connection', scopes: [] }],
      [{ action: 'update-agent', id: 'connection' }],
      [{ action: 'update-agent', scopes: ['files:read'] }],
      [{ action: 'update-agent', id: 'connection', scopes: 'files:read' }],
      [
        {
          action: 'update-agent',
          id: 'connection',
          scopes: ['files:read', 'admin:everything'],
        },
      ],
      [
        {
          action: 'update-agent',
          id: 'connection',
          scopes: ['files:read'],
          userId: 'other',
        },
      ],
    ])('refuses the malformed command %j', async (command) => {
      const error = await refusal(runIntegrationCommand(reader, command))
      expect([error.status, error.message]).toEqual([
        400,
        'Check the integration settings and try again.',
      ])
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it("refuses another account's connection, and one that already ended", async () => {
      db.tx.agentConnection.updateMany.mockResolvedValue({ count: 0 })
      const error = await refusal(update(['files:read']))
      expect(error).toBeInstanceOf(IntegrationError)
      expect(error.message).toBe('Agent not found or already disconnected.')
    })

    it('refuses while the MCP server is off', async () => {
      mcp(false)
      expect((await refusal(update(['files:read']))).message).toBe(
        'The MCP server is turned off on this instance, so agent permissions cannot be changed.'
      )
      expect(db.tx.agentConnection.updateMany).not.toHaveBeenCalled()
    })
  })
})

describe('the integrations screen', () => {
  beforeEach(() => {
    db.list.mockResolvedValue([])
    db.connections.mockResolvedValue([])
  })

  describe('connected agents', () => {
    const row = {
      id: 'connection-1',
      clientName: 'Claude Code (flare)',
      redirectUri: 'http://localhost:53124/callback',
      scopes: ['urls:read', 'files:read', 'mcp'],
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
      lastUsedAt: null,
    }

    it('lists the live connections of an account that manages tokens', async () => {
      db.mcpEnabled.mockResolvedValue(true)
      db.connections.mockResolvedValue([row])
      const screen = await listIntegrations(owner)
      expect(screen.connections).toEqual([
        {
          id: 'connection-1',
          clientName: 'Claude Code (flare)',
          // Where the sign-in sent the browser back to.
          returnsTo: 'http://localhost:53124/callback',
          // In catalog order, without anything a sign-in cannot grant.
          scopes: ['files:read', 'urls:read'],
          createdAt: row.createdAt,
          lastUsedAt: null,
        },
      ])
      expect(db.connections).toHaveBeenCalledExactlyOnceWith({
        where: {
          userId: 'owner',
          revokedAt: null,
          tokens: { some: { refreshExpiresAt: { gt: expect.any(Date) } } },
        },
        select: {
          id: true,
          clientName: true,
          redirectUri: true,
          scopes: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    })

    it('returns nothing that is a secret or belongs to the client record', async () => {
      db.mcpEnabled.mockResolvedValue(true)
      db.connections.mockResolvedValue([row])
      const [connection] = (await listIntegrations(owner)).connections!
      expect(Object.keys(connection).sort()).toEqual([
        'clientName',
        'createdAt',
        'id',
        'lastUsedAt',
        'returnsTo',
        'scopes',
      ])
    })

    it('lists none, without asking, while the MCP server is off', async () => {
      db.mcpEnabled.mockResolvedValue(false)
      expect((await listIntegrations(owner)).connections).toEqual([])
      expect(db.connections).not.toHaveBeenCalled()
    })

    it('leaves them out for an account that cannot manage tokens', async () => {
      db.mcpEnabled.mockResolvedValue(true)
      db.connections.mockResolvedValue([row])
      const screen = await listIntegrations({
        id: 'owner',
        permissions: ['webhooks.manage'],
      })
      expect(screen).not.toHaveProperty('connections')
      expect(db.connections).not.toHaveBeenCalled()
    })
  })

  it('tells an account that manages tokens whether agents can connect, and where', async () => {
    db.mcpEnabled.mockResolvedValue(true)
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example.com/')
    expect((await listIntegrations(owner)).mcp).toEqual({
      enabled: true,
      url: 'https://files.example.com/api/mcp',
    })
    // An address under a path keeps it, as every generated link does.
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com/flare')
    expect((await listIntegrations(owner)).mcp).toEqual({
      enabled: true,
      url: 'https://example.com/flare/api/mcp',
    })
    // Without a configured address the page uses the one it was opened at.
    vi.stubEnv('NEXTAUTH_URL', '')
    expect((await listIntegrations(owner)).mcp).toEqual({
      enabled: true,
      url: null,
    })
  })

  it('says nothing more than off while the MCP server is off', async () => {
    db.mcpEnabled.mockResolvedValue(false)
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example.com')
    expect((await listIntegrations(owner)).mcp).toEqual({
      enabled: false,
      url: null,
    })
  })

  it('leaves agents out for an account that cannot manage tokens', async () => {
    db.mcpEnabled.mockResolvedValue(true)
    const screen = await listIntegrations({
      id: 'owner',
      permissions: ['webhooks.manage'],
    })
    expect(screen).not.toHaveProperty('mcp')
    expect(db.mcpEnabled).not.toHaveBeenCalled()
  })
})
