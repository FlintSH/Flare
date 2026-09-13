import type { MailOutbox } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decryptSecret, encryptSecret } from '@/lib/email/crypto'
import {
  MailLimitError,
  deliverClaimedMail,
  enqueueMail,
  retryMail,
} from '@/lib/email/outbox'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'

const doubles = vi.hoisted(() => ({
  sendMail: vi.fn(),
  getEmailConfig: vi.fn(),
  db: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    mailOutbox: {
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailToken: { findUnique: vi.fn() },
    emailRateLimit: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: doubles.db }))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: doubles.getEmailConfig,
}))
vi.mock('@/lib/email/transport', async (original) => ({
  ...(await original<typeof import('@/lib/email/transport')>()),
  sendMail: doubles.sendMail,
}))

const now = new Date('2026-09-13T12:00:00.000Z')
const config = {
  ...structuredClone(DEFAULT_EMAIL_CONFIG),
  enabled: true,
  publicUrl: 'https://flare.test',
  recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true },
}

function queued(overrides: Partial<MailOutbox> = {}): MailOutbox {
  return {
    id: 'mail-1',
    userId: 'user-1',
    tokenId: 'token-1',
    purpose: 'reset',
    recipient: 'user@example.com',
    payload: encryptSecret(
      JSON.stringify({
        subject: 'Reset password',
        text: 'secret-link',
        html: '<p>secret-link</p>',
      }),
      'outbox'
    ),
    status: 'processing',
    attempts: 1,
    maxAttempts: 3,
    availableAt: now,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    leaseUntil: new Date(now.getTime() + 120_000),
    leaseId: 'worker-1',
    sentAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.stubEnv(
    'FLARE_EMAIL_ENCRYPTION_KEY',
    'test-email-key-with-at-least-32-characters'
  )
  doubles.getEmailConfig.mockResolvedValue(config)
  doubles.db.mailOutbox.count.mockResolvedValue(0)
  doubles.db.emailRateLimit.findUnique.mockResolvedValue(null)
  doubles.db.mailOutbox.create.mockImplementation(async ({ data }) => data)
  doubles.db.mailOutbox.updateMany.mockResolvedValue({ count: 1 })
  doubles.db.mailOutbox.findUnique.mockResolvedValue({
    status: 'processing',
    leaseId: 'worker-1',
    leaseUntil: new Date(now.getTime() + 120_000),
  })
  doubles.db.emailToken.findUnique.mockResolvedValue({
    id: 'token-1',
    userId: 'user-1',
    purpose: 'reset',
    email: 'user@example.com',
    consumedAt: null,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
  })
  doubles.sendMail.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('durable mail admission', () => {
  it('encrypts link-bearing content and serializes daily admission before inserting', async () => {
    const input = {
      userId: 'user-1',
      tokenId: 'token-1',
      purpose: 'reset',
      recipient: 'user@example.com',
      subject: 'Reset',
      text: 'secret-link',
      html: '<p>secret-link</p>',
    }
    await enqueueMail(doubles.db as never, input, config)
    const row = doubles.db.mailOutbox.create.mock.calls[0][0].data
    expect(row.payload).not.toContain('secret-link')
    expect(JSON.parse(decryptSecret(row.payload, 'outbox'))).toEqual({
      subject: 'Reset',
      text: 'secret-link',
      html: '<p>secret-link</p>',
    })
    expect(row).toMatchObject({ tokenId: 'token-1', maxAttempts: 3 })
    expect(doubles.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      doubles.db.emailRateLimit.findUnique.mock.invocationCallOrder[0]
    )
    expect(
      doubles.db.emailRateLimit.findUnique.mock.invocationCallOrder[0]
    ).toBeLessThan(doubles.db.mailOutbox.create.mock.invocationCallOrder[0])
  })

  it('refuses admission once the shared daily cap is reached', async () => {
    doubles.db.emailRateLimit.findUnique.mockResolvedValue({
      count: config.limits.dailyLimit,
    })
    await expect(
      enqueueMail(
        doubles.db as never,
        {
          purpose: 'test',
          recipient: 'user@example.com',
          subject: 'test',
          text: 'test',
          html: 'test',
        },
        config
      )
    ).rejects.toBeInstanceOf(MailLimitError)
    expect(doubles.db.mailOutbox.create).not.toHaveBeenCalled()
  })
})

describe('mail processing and recovery', () => {
  it('sends a claimed token once and immediately removes secret payloads from diagnostics', async () => {
    expect(await deliverClaimedMail(queued(), config)).toBe(true)
    expect(doubles.sendMail).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        recipient: 'user@example.com',
        text: 'secret-link',
        messageId: '<flare-mail-1@flare.test>',
      })
    )
    expect(doubles.db.mailOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'mail-1', status: 'processing', leaseId: 'worker-1' },
      data: expect.objectContaining({
        status: 'sent',
        payload: '',
        leaseUntil: null,
        leaseId: null,
      }),
    })
  })

  it.each([
    'consumed',
    'expired',
    'address_changed',
    'purpose_changed',
    'deleted',
  ] as const)('discards %s links before connecting to SMTP', async (reason) => {
    const token = {
      userId: 'user-1',
      purpose: 'reset',
      email: 'user@example.com',
      consumedAt: null as Date | null,
      expiresAt: new Date(now.getTime() + 60_000),
    }
    if (reason === 'consumed') token.consumedAt = now
    if (reason === 'expired') token.expiresAt = now
    if (reason === 'address_changed') token.email = 'other@example.com'
    if (reason === 'purpose_changed') token.purpose = 'verify'
    doubles.db.emailToken.findUnique.mockResolvedValue(
      reason === 'deleted' ? null : token
    )
    expect(await deliverClaimedMail(queued(), config)).toBe(false)
    expect(doubles.sendMail).not.toHaveBeenCalled()
    expect(doubles.db.mailOutbox.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled', payload: '' }),
      })
    )
  })

  it('does not send a token whose foreign key was cleared by deletion', async () => {
    await deliverClaimedMail(queued({ tokenId: null }), config)
    expect(doubles.sendMail).not.toHaveBeenCalled()
  })

  it('delays transient failures with exponential backoff and keeps only sanitized errors', async () => {
    doubles.sendMail.mockRejectedValue({
      responseCode: 450,
      message: 'secret-link and smtp-password and secret@example.com',
    })
    expect(await deliverClaimedMail(queued({ attempts: 2 }), config)).toBe(
      false
    )
    const result = doubles.db.mailOutbox.updateMany.mock.calls.at(-1)![0].data
    expect(result).toMatchObject({
      status: 'pending',
      availableAt: new Date(
        now.getTime() + config.delivery.retrySeconds * 2_000
      ),
    })
    expect(result.lastError).toContain('(450)')
    expect(result.lastError).not.toContain('secret')
    expect(result).not.toHaveProperty('payload')
  })

  it.each([
    ['permanent SMTP rejection', { responseCode: 550 }, 1, 30 * 60_000],
    ['exhausted attempts', { responseCode: 450 }, 3, 30 * 60_000],
    ['retry after token expiry', { responseCode: 450 }, 1, 10_000],
  ] as const)(
    'stops retrying after %s',
    async (_reason, error, attempts, expiresIn) => {
      doubles.sendMail.mockRejectedValue(error)
      await deliverClaimedMail(
        queued({ attempts, expiresAt: new Date(now.getTime() + expiresIn) }),
        config
      )
      expect(doubles.db.mailOutbox.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        })
      )
    }
  )

  it('checks disabled delivery and mail expiry before sending', async () => {
    await deliverClaimedMail(queued(), { ...config, enabled: false })
    await deliverClaimedMail(queued({ expiresAt: now }), config)
    expect(doubles.sendMail).not.toHaveBeenCalled()
  })

  it('rechecks current enablement after a worker claims an earlier enabled configuration', async () => {
    doubles.getEmailConfig.mockResolvedValue({ ...config, enabled: false })
    expect(await deliverClaimedMail(queued(), config)).toBe(false)
    expect(doubles.sendMail).not.toHaveBeenCalled()
    expect(doubles.db.mailOutbox.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled', payload: '' }),
      })
    )
  })

  it('refuses to manually retry expired or consumed links', async () => {
    doubles.db.mailOutbox.findUnique.mockResolvedValue(
      queued({ status: 'failed', expiresAt: now })
    )
    expect(await retryMail('mail-1')).toBe(false)
    doubles.db.mailOutbox.findUnique.mockResolvedValue(
      queued({ status: 'failed' })
    )
    doubles.db.emailToken.findUnique.mockResolvedValue({
      consumedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    expect(await retryMail('mail-1')).toBe(false)
    expect(doubles.db.mailOutbox.updateMany).not.toHaveBeenCalled()
  })
})
