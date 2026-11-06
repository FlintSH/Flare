import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HttpError } from '@/lib/http/errors'
import {
  IntegrationError,
  runIntegrationCommand,
} from '@/lib/integrations/service'
import { WEBHOOK_SECRET_PURPOSE } from '@/lib/integrations/webhooks'
import { decryptSecret } from '@/lib/security/secret-box'

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    apiToken: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
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
  prisma: { $transaction: db.transaction },
}))
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
