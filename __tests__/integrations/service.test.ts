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
  mcpEnabled: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    apiToken: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
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

describe('the integrations screen', () => {
  beforeEach(() => db.list.mockResolvedValue([]))

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
