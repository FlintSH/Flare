import { GET, POST } from '@/app/api/integrations/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  list: vi.fn(),
  transaction: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    webhook: { delete: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    apiToken: { findMany: mocks.list },
    webhook: { findMany: mocks.list },
    webhookDelivery: { findMany: mocks.list },
    uploadProfile: { findMany: mocks.list },
  },
}))

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({
    user: { id: 'owner', permissions: ['webhooks.manage'] },
  })
  mocks.list.mockResolvedValue([{ id: 'row' }])
  mocks.transaction.mockImplementation(
    (run: (tx: typeof mocks.tx) => Promise<unknown>) => run(mocks.tx)
  )
})

describe('integrations route', () => {
  it('lists only what the account manages, uncached', async () => {
    const response = await GET(new Request('http://localhost/api/integrations'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      tokens: [],
      webhooks: [{ id: 'row' }],
      deliveries: [{ id: 'row' }],
      profiles: [],
    })
  })

  it('answers command results and refusals uncached', async () => {
    mocks.tx.webhook.findFirst.mockResolvedValueOnce({ id: 'hook' })
    const deleted = await post({ action: 'delete-webhook', id: 'hook' })
    expect(deleted.status).toBe(200)
    expect(deleted.headers.get('cache-control')).toBe('no-store')
    expect(await deleted.json()).toEqual({ ok: true })

    mocks.tx.webhook.findFirst.mockResolvedValueOnce(null)
    const missing = await post({ action: 'delete-webhook', id: 'gone' })
    expect(missing.status).toBe(400)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(await missing.json()).toEqual({ error: 'Webhook not found.' })
  })

  it('answers invalid and unauthorized commands before any change', async () => {
    const invalid = await post({ action: 'delete-webhook' })
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('cache-control')).toBe('private, no-store')
    expect(await invalid.json()).toEqual({
      error: 'Check the integration settings and try again.',
    })
    const forbidden = await post({ action: 'revoke-token', id: 'token' })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      error: 'You do not have permission to perform this action.',
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
