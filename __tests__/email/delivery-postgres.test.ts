import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { prisma } from '@/lib/database/prisma'
import {
  MailLimitError,
  claimMail,
  cleanupMail,
  deliverClaimedMail,
  deliverTestEmail,
  enqueueMail,
} from '@/lib/email/outbox'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { sendMail } from '@/lib/email/transport'

vi.mock('@/lib/database/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return {
    prisma: new PrismaClient({
      datasourceUrl:
        process.env.FLARE_EMAIL_DELIVERY_DATABASE_URL ||
        'postgresql://unused:unused@127.0.0.1:1/unused',
    }),
  }
})
vi.mock('@/lib/email/config', () => ({ getEmailConfig: vi.fn() }))
vi.mock('@/lib/email/transport', async (original) => ({
  ...(await original<typeof import('@/lib/email/transport')>()),
  sendMail: vi.fn().mockResolvedValue(undefined),
}))

// Opt-in: this suite owns a disposable database, never the running instance DB.
const databaseUrl = process.env.FLARE_EMAIL_DELIVERY_DATABASE_URL
let databaseReady = false
const config = {
  ...structuredClone(DEFAULT_EMAIL_CONFIG),
  enabled: true,
  publicUrl: 'https://flare.test',
}
const message = {
  purpose: 'test',
  recipient: 'queue-test@example.com',
  subject: 'Test',
  text: 'test',
  html: '<p>test</p>',
}

describe.skipIf(!databaseUrl)(
  'PostgreSQL outbox concurrency and restart recovery',
  () => {
    beforeAll(async () => {
      if (new URL(databaseUrl!).pathname !== '/flare_email_delivery')
        throw new Error(
          'Use a disposable database named flare_email_delivery for these tests.'
        )
      vi.stubEnv(
        'FLARE_EMAIL_ENCRYPTION_KEY',
        'disposable-delivery-test-key-at-least-32-characters'
      )
      await prisma.$connect()
      databaseReady = true
    })
    beforeEach(async () => {
      vi.clearAllMocks()
      await prisma.mailOutbox.deleteMany()
      await prisma.emailRateLimit.deleteMany({
        where: { key: { startsWith: 'mail:daily:' } },
      })
    })
    afterAll(async () => {
      if (!databaseReady) return
      await prisma.mailOutbox.deleteMany()
      await prisma.emailRateLimit.deleteMany({
        where: { key: { startsWith: 'mail:daily:' } },
      })
      await prisma.$disconnect()
      vi.unstubAllEnvs()
    })

    it('gives each concurrent worker exclusive claims', async () => {
      for (let index = 0; index < 8; index++) {
        await prisma.$transaction((tx) => enqueueMail(tx, message, config))
      }
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          claimMail({
            ...config,
            delivery: { ...config.delivery, concurrency: 8 },
          })
        )
      )
      const claims = results.flat()
      expect(claims).toHaveLength(8)
      expect(new Set(claims.map((mail) => mail.id)).size).toBe(8)
      expect(
        claims.every(
          (mail) => mail.status === 'processing' && mail.attempts === 1
        )
      ).toBe(true)
    })

    it('bounds active deliveries across simultaneous workers to the instance concurrency', async () => {
      for (let index = 0; index < 6; index++) {
        await prisma.$transaction((tx) => enqueueMail(tx, message, config))
      }
      const results = await Promise.all([
        claimMail(config),
        claimMail(config),
        claimMail(config),
      ])
      expect(results.flat()).toHaveLength(config.delivery.concurrency)
      expect(
        await prisma.mailOutbox.count({ where: { status: 'processing' } })
      ).toBe(config.delivery.concurrency)
      expect(
        await prisma.mailOutbox.count({ where: { status: 'pending' } })
      ).toBe(6 - config.delivery.concurrency)
    })

    it('enforces the instance cap across concurrent transactions', async () => {
      const limited = { ...config, limits: { ...config.limits, dailyLimit: 2 } }
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          prisma.$transaction((tx) => enqueueMail(tx, message, limited))
        )
      )
      expect(
        results.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(2)
      const failures = results.filter((result) => result.status === 'rejected')
      expect(failures).toHaveLength(6)
      for (const result of failures)
        expect(result.reason).toBeInstanceOf(MailLimitError)
      expect(await prisma.mailOutbox.count()).toBe(2)
    })

    it('does not refund daily sending capacity when delivery history is deleted', async () => {
      const limited = { ...config, limits: { ...config.limits, dailyLimit: 1 } }
      await prisma.$transaction((tx) => enqueueMail(tx, message, limited))
      await prisma.mailOutbox.deleteMany()
      await expect(
        prisma.$transaction((tx) => enqueueMail(tx, message, limited))
      ).rejects.toBeInstanceOf(MailLimitError)
    })

    it('recovers an expired lease after reconnecting and refuses delivery by the superseded worker', async () => {
      const original = await prisma.$transaction((tx) =>
        enqueueMail(tx, message, config)
      )
      const [firstClaim] = await claimMail(config)
      expect(await claimMail(config)).toHaveLength(0)
      await prisma.mailOutbox.update({
        where: { id: original.id },
        data: { leaseUntil: new Date(Date.now() - 1_000) },
      })
      await prisma.$disconnect()
      const [recovered] = await claimMail(config)
      expect(recovered.id).toBe(original.id)
      expect(recovered.attempts).toBe(2)
      expect(recovered.leaseId).not.toBe(firstClaim.leaseId)
      expect(await deliverClaimedMail(firstClaim, config)).toBe(false)
      expect(sendMail).not.toHaveBeenCalled()
      expect(await deliverClaimedMail(recovered, config)).toBe(true)
      expect(sendMail).toHaveBeenCalledTimes(1)
      expect(
        await prisma.mailOutbox.findUnique({ where: { id: original.id } })
      ).toMatchObject({
        status: 'sent',
        payload: '',
        attempts: 2,
        leaseId: null,
      })
    })

    it('does not reclaim delayed mail or retry exhausted jobs indefinitely', async () => {
      const delayed = await prisma.$transaction((tx) =>
        enqueueMail(tx, message, config)
      )
      const exhausted = await prisma.$transaction((tx) =>
        enqueueMail(tx, message, config)
      )
      await prisma.mailOutbox.update({
        where: { id: delayed.id },
        data: { availableAt: new Date(Date.now() + 60_000) },
      })
      await prisma.mailOutbox.update({
        where: { id: exhausted.id },
        data: {
          status: 'processing',
          attempts: 3,
          leaseUntil: new Date(Date.now() - 1_000),
        },
      })
      expect(await claimMail(config)).toHaveLength(0)
      await cleanupMail(config)
      expect(
        await prisma.mailOutbox.findUnique({ where: { id: exhausted.id } })
      ).toMatchObject({ status: 'failed', leaseId: null, leaseUntil: null })
      expect(
        await prisma.mailOutbox.findUnique({ where: { id: delayed.id } })
      ).toMatchObject({ status: 'pending' })
    })

    it('never automatically retries a failed draft test through saved SMTP settings', async () => {
      vi.mocked(sendMail).mockRejectedValueOnce({ responseCode: 450 })
      await expect(
        deliverTestEmail(config, 'draft-test@example.com')
      ).rejects.toThrow('temporarily')
      expect(
        await prisma.mailOutbox.findFirst({
          where: { recipient: 'draft-test@example.com' },
        })
      ).toMatchObject({ status: 'failed', attempts: 1, maxAttempts: 1 })
      expect(await claimMail(config)).toHaveLength(0)
    })
  }
)
