import type { Prisma, WebhookDelivery } from '@prisma/client'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { encryptSecret } from '@/lib/email/crypto'
import { signWebhook } from '@/lib/integrations/security'
import {
  WEBHOOK_SECRET_PURPOSE,
  deliverWebhook,
  enqueueFileReady,
  fileReadyPayload,
  retryDelayMs,
  sendWebhook,
} from '@/lib/integrations/webhooks'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  file: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { webhookDelivery: db, file: { findUnique: db.file } },
}))

let server: Server
let origin = ''
let received: {
  path: string
  body: string
  headers: Record<string, string | string[] | undefined>
}[]
const secret = 'whsec_test-secret'

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', 'true')
  vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
  vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY_FILE', '')
  vi.stubEnv(
    'NEXTAUTH_SECRET',
    'test-secret-for-webhooks-at-least-32-characters'
  )
  received = []
  db.file.mockResolvedValue({
    userId: 'user',
    visibility: 'PUBLIC',
    password: null,
  })
  server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    received.push({ path: request.url || '', body, headers: request.headers })
    if (request.url === '/redirect') {
      response.writeHead(302, { location: `${origin}/never` })
      response.end()
      return
    }
    if (request.url === '/retry') {
      response.writeHead(503)
      response.end('private-response-content')
      return
    }
    if (request.url === '/reject') {
      response.writeHead(400)
      response.end()
      return
    }
    if (request.url === '/large') {
      response.end('x'.repeat(33 * 1024))
      return
    }
    response.writeHead(204)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  origin = `http://localhost:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  vi.unstubAllEnvs()
})

function claimed(attempts = 1): WebhookDelivery {
  const now = new Date()
  return {
    id: 'delivery',
    eventId: 'file.ready:file',
    webhookId: 'hook',
    payload: {
      id: 'file.ready:file',
      type: 'file.ready',
      version: 1,
      data: { id: 'file', visibility: 'PUBLIC', passwordProtected: false },
    },
    status: 'processing',
    attempts,
    availableAt: now,
    leaseId: 'lease',
    leaseUntil: new Date(Date.now() + 60_000),
    lastError: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function configure(delivery: WebhookDelivery, path = '/ok') {
  db.findUnique.mockResolvedValue({
    ...delivery,
    webhook: {
      userId: 'user',
      enabled: true,
      url: origin + path,
      secret: encryptSecret(secret, WEBHOOK_SECRET_PURPOSE),
    },
  })
  db.updateMany.mockResolvedValue({ count: 1 })
}

describe('webhook delivery contract', () => {
  it('skips notifications at capacity without failing the upload transaction', async () => {
    const count = vi.fn().mockResolvedValue(5000)
    const createMany = vi.fn()
    const tx = {
      $executeRaw: vi.fn(),
      webhook: { findMany: vi.fn(async () => [{ id: 'hook' }]) },
      webhookDelivery: { count, createMany },
    } as unknown as Prisma.TransactionClient
    await expect(
      enqueueFileReady(tx, {
        id: 'file',
        userId: 'user',
        name: 'file.png',
        mimeType: 'image/png',
        size: 1,
        uploadedAt: new Date(),
        visibility: 'PUBLIC',
        password: null,
      })
    ).resolves.toBeUndefined()
    expect(createMany).not.toHaveBeenCalled()
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(1000)
    await expect(
      enqueueFileReady(tx, {
        id: 'file',
        userId: 'user',
        name: 'file.png',
        mimeType: 'image/png',
        size: 1,
        uploadedAt: new Date(),
        visibility: 'PUBLIC',
        password: null,
      })
    ).resolves.toBeUndefined()
    expect(createMany).not.toHaveBeenCalled()
  })
  it('sends signed bytes and stable event IDs through a pinned DNS connection', async () => {
    const event = claimed()
    configure(event)
    await deliverWebhook(event)
    expect(received).toHaveLength(1)
    const request = received[0]
    expect(request.headers['x-flare-event-id']).toBe(event.eventId)
    expect(request.headers['x-flare-signature']).toBe(
      signWebhook(
        secret,
        request.headers['x-flare-timestamp'] as string,
        request.body
      )
    )
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'delivery', status: 'processing', leaseId: 'lease' },
        data: expect.objectContaining({ status: 'delivered', leaseId: null }),
      })
    )
  })
  it('does not follow redirects or retain remote response bodies', async () => {
    await expect(
      sendWebhook(origin + '/redirect', secret, 'event', {})
    ).resolves.toBe(302)
    expect(received.map((item) => item.path)).toEqual(['/redirect'])
    const event = claimed()
    configure(event, '/retry')
    await deliverWebhook(event)
    expect(JSON.stringify(db.updateMany.mock.calls)).not.toContain(
      'private-response-content'
    )
  })
  it('bounds response bytes', async () => {
    await expect(
      sendWebhook(origin + '/large', secret, 'event', {})
    ).rejects.toThrow('32 KiB')
  })
  it.each([
    [1, '/retry', 'pending'],
    [5, '/retry', 'failed'],
    [1, '/reject', 'failed'],
  ])(
    'bounds retries after attempt %s at %s',
    async (attempts, path, status) => {
      const event = claimed(attempts as number)
      configure(event, path as string)
      await deliverWebhook(event)
      expect(db.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status,
            leaseId: null,
            leaseUntil: null,
          }),
        })
      )
    }
  )
  it('rejects expired or replaced leases without sending', async () => {
    const event = claimed()
    configure({ ...event, leaseUntil: new Date(0) })
    await deliverWebhook(event)
    expect(received).toHaveLength(0)
    configure({ ...event, leaseId: 'replacement' })
    await deliverWebhook(event)
    expect(received).toHaveLength(0)
  })
  it('uses a bounded backoff schedule', () => {
    expect([1, 2, 3, 4, 5, 100].map(retryDelayMs)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000,
    ])
  })
  it.each([
    null,
    { userId: 'another-user', visibility: 'PUBLIC', password: null },
    { userId: 'user', visibility: 'PRIVATE', password: null },
    { userId: 'user', visibility: 'PUBLIC', password: 'hash' },
  ])('cancels delivery when source access no longer matches', async (file) => {
    const event = claimed()
    configure(event)
    db.file.mockResolvedValue(file)
    await deliverWebhook(event)
    expect(received).toHaveLength(0)
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled' }),
      })
    )
  })
  it('constructs an explicit minimal file payload', () => {
    const file = {
      id: 'file',
      userId: 'user',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 1,
      uploadedAt: new Date(0),
      visibility: 'PRIVATE' as const,
      password: 'password-hash',
      ocrText: 'private text',
      path: '/private',
      urlPath: '?signature=secret',
    }
    expect(fileReadyPayload(file)).toEqual({
      version: 1,
      id: 'file.ready:file',
      type: 'file.ready',
      occurredAt: new Date(0).toISOString(),
      data: {
        id: 'file',
        name: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 1048576,
        visibility: 'PRIVATE',
        passwordProtected: true,
      },
    })
  })
})
