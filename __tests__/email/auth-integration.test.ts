import { POST as changeEmail } from '@/app/api/auth/email/change/route'
import { POST as enroll } from '@/app/api/auth/email/enroll/route'
import { POST as resend } from '@/app/api/auth/email/resend/route'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as adminEmail } from '@/app/api/users/[id]/email/route'
import { Prisma, type User } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import { createHash, randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_CONFIG } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import {
  confirmEmailToken,
  requestPasswordReset,
  resetPassword,
} from '@/lib/email/account'
import { decryptSecret } from '@/lib/email/crypto'
import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/email/schema'
import { issueEmailToken } from '@/lib/email/tokens'

const state = vi.hoisted(() => ({
  enforceSso: false,
  session: null as unknown,
  config: null as unknown,
}))
vi.mock('next-auth', async (original) => ({
  ...(await original<object>()),
  getServerSession: async () => state.session,
}))
vi.mock('@/lib/database/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return {
    prisma: new PrismaClient({
      datasourceUrl:
        process.env.FLARE_EMAIL_AUTH_DATABASE_URL ||
        'postgresql://unused@127.0.0.1/unused',
    }),
  }
})
vi.mock('@/lib/email/config', async (original) => ({
  ...(await original<object>()),
  getEmailConfig: async () => state.config,
}))
vi.mock('@/lib/config', async (original) => ({
  ...(await original<object>()),
  getConfig: async () => ({
    settings: {
      general: {
        registrations: { enabled: true },
        oidc: { enabled: true, enforceSso: state.enforceSso },
      },
    },
  }),
}))

// Deliberately opt in to a disposable migrated database; never use DATABASE_URL.
describe.skipIf(!process.env.FLARE_EMAIL_AUTH_DATABASE_URL)(
  'email account transactions (PostgreSQL)',
  () => {
    const ids: string[] = []
    let config: EmailConfig
    let passwordHash: string
    let savedSecret: string | undefined

    beforeAll(async () => {
      savedSecret = process.env.NEXTAUTH_SECRET
      process.env.NEXTAUTH_SECRET =
        'email-account-integration-test-secret-0123456789'
      passwordHash = await hash('old-password', 10)
      await prisma.$connect()
      await prisma.emailRateLimit.deleteMany({
        where: { key: { startsWith: 'mail:daily:' } },
      })
    })
    beforeEach(async () => {
      config = {
        ...structuredClone(DEFAULT_EMAIL_CONFIG),
        enabled: true,
        smtp: {
          ...DEFAULT_EMAIL_CONFIG.smtp,
          host: 'smtp.example',
          authentication: false,
        },
        fromAddress: 'no-reply@example.com',
        publicUrl: 'https://flare.example',
        recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true },
      }
      state.config = config
      state.session = null
      state.enforceSso = false
      await persistConfig(config)
    })
    afterEach(async () => {
      await prisma.config.deleteMany({ where: { key: 'flare_config' } })
      await prisma.user.deleteMany({ where: { id: { in: ids.splice(0) } } })
      await prisma.emailRateLimit.deleteMany({
        where: { key: { startsWith: 'mail:daily:' } },
      })
    })
    afterAll(async () => {
      await prisma.$disconnect()
      if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET
      else process.env.NEXTAUTH_SECRET = savedSecret
    })

    async function user(
      overrides: Partial<Prisma.UserCreateInput> = {}
    ): Promise<User> {
      const id = randomUUID()
      const email = `${id}@example.com`
      ids.push(id)
      return prisma.user.create({
        data: {
          id,
          email,
          name: 'Test user',
          password: passwordHash,
          urlId: id,
          uploadToken: randomUUID(),
          emailVerified: new Date(),
          emailVerifiedFor: email,
          emailVerificationSource: 'email',
          ...overrides,
        },
      })
    }

    async function persistConfig(
      email: EmailConfig,
      tx: Pick<Prisma.TransactionClient, 'config'> = prisma
    ) {
      const value = JSON.parse(
        JSON.stringify({
          ...DEFAULT_CONFIG,
          settings: {
            ...DEFAULT_CONFIG.settings,
            email,
            general: {
              ...DEFAULT_CONFIG.settings.general,
              oidc: {
                ...DEFAULT_CONFIG.settings.general.oidc,
                enabled: true,
                enforceSso: state.enforceSso,
              },
            },
          },
        })
      ) as Prisma.InputJsonValue
      await tx.config.upsert({
        where: { key: 'flare_config' },
        create: { key: 'flare_config', value },
        update: { value },
      })
    }

    async function changeLink(userId: string, purpose = 'change') {
      const mail = await prisma.mailOutbox.findFirstOrThrow({
        where: { userId, purpose },
        orderBy: { createdAt: 'desc' },
      })
      const payload = JSON.parse(decryptSecret(mail.payload, 'outbox')) as {
        text: string
      }
      const match = payload.text.match(
        /https:\/\/flare\.example\/auth\/verify-email\?token=([A-Za-z0-9_-]+)/
      )
      expect(match).not.toBeNull()
      return match![1]
    }

    async function waitForSettingsLockWaiter() {
      for (let attempt = 0; attempt < 100; attempt++) {
        const [result] = await prisma.$queryRaw<Array<{ waiting: number }>>`
          SELECT COUNT(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND objid = 721150092 AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`
        if (result.waiting > 0) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error(
        'Account confirmation did not wait for the settings transaction'
      )
    }
    function token(
      account: User,
      purpose: 'verify' | 'reset' | 'change' | 'change_approval' = 'reset',
      email = account.email!,
      expiresAt = new Date(Date.now() + 60000)
    ) {
      return prisma.$transaction((tx) =>
        issueEmailToken(tx, { userId: account.id, email, purpose, expiresAt })
      )
    }
    function request(body: unknown) {
      return new Request('https://flare.example/api/auth/email/enroll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-real-ip': randomUUID(),
        },
        body: JSON.stringify(body),
      })
    }

    async function exhaustDailyQuota() {
      const key = `mail:daily:${new Date().toISOString().slice(0, 10)}`
      const resetAt = new Date(Date.now() + 86400000)
      await prisma.emailRateLimit.upsert({
        where: { key },
        create: { key, count: 1, resetAt },
        update: { count: 1, resetAt },
      })
    }

    it('requires account authentication before enrolling a legacy setup timestamp as recovery proof', async () => {
      const account = await user({
        emailVerifiedFor: null,
        emailVerificationSource: null,
      })
      await requestPasswordReset(account.email!, config)
      expect(
        await prisma.emailToken.count({ where: { userId: account.id } })
      ).toBe(0)
      const bearerRequest = request({ password: 'old-password' })
      bearerRequest.headers.set(
        'authorization',
        `Bearer ${account.uploadToken}`
      )
      expect((await enroll(bearerRequest)).status).toBe(401)
      state.session = { user: { id: account.id } }
      expect((await resend(request({}))).status).toBe(400)
      // Expire this account's cooldown between intentional negative attempts.
      const cooldownKey = createHash('sha256')
        .update(`email:cooldown:${account.email}`)
        .digest('hex')
      await prisma.emailRateLimit.update({
        where: { key: cooldownKey },
        data: { resetAt: new Date(0) },
      })
      expect(
        (await enroll(request({ password: 'wrong-password' }))).status
      ).toBe(400)
      await prisma.emailRateLimit.update({
        where: { key: cooldownKey },
        data: { resetAt: new Date(0) },
      })
      const response = await enroll(request({ password: 'old-password' }))
      expect(
        response.status,
        JSON.stringify(await response.clone().json())
      ).toBe(200)
      const mail = await prisma.mailOutbox.findFirstOrThrow({
        where: { userId: account.id, purpose: 'verify' },
      })
      const payload = JSON.parse(decryptSecret(mail.payload, 'outbox')) as {
        text: string
      }
      const match = payload.text.match(
        /https:\/\/flare\.example\/auth\/verify-email\?token=([A-Za-z0-9_-]+)/
      )
      expect(match).not.toBeNull()
      await confirmEmailToken(match![1], config)
      const verified = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
      })
      expect(verified.emailVerifiedFor).toBe(account.email)
      expect(verified.emailVerificationSource).toBe('email')
      await requestPasswordReset(account.email!, config)
      expect(
        await prisma.emailToken.count({
          where: { userId: account.id, purpose: 'reset' },
        })
      ).toBe(1)
    })

    it('allows only one concurrent reset and revokes sessions and outstanding links atomically', async () => {
      const account = await user()
      const reset = await token(account)
      await token(account, 'verify')
      const results = await Promise.allSettled([
        resetPassword(reset.token, 'new-password-one', config),
        resetPassword(reset.token, 'new-password-two', config),
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1)
      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
      })
      expect(updated.sessionVersion).toBe(account.sessionVersion + 1)
      expect(updated.uploadToken).toBe(account.uploadToken)
      expect(await compare('old-password', updated.password!)).toBe(false)
      expect(
        await prisma.emailToken.count({
          where: { userId: account.id, consumedAt: null },
        })
      ).toBe(0)
    })

    it('rejects expired, wrong-purpose and changed-address tokens without consuming them', async () => {
      const account = await user()
      const expired = await token(
        account,
        'reset',
        account.email!,
        new Date(Date.now() - 1)
      )
      await expect(
        resetPassword(expired.token, 'new-password', config)
      ).rejects.toThrow('invalid or expired')
      const wrongPurpose = await token(account, 'verify')
      await expect(
        resetPassword(wrongPurpose.token, 'new-password', config)
      ).rejects.toThrow('invalid or expired')
      const stale = await token(account)
      await prisma.user.update({
        where: { id: account.id },
        data: {
          email: `new-${account.email}`,
          emailVerifiedFor: `new-${account.email}`,
        },
      })
      await expect(
        resetPassword(stale.token, 'new-password', config)
      ).rejects.toThrow('invalid or expired')
      expect(
        (
          await prisma.emailToken.findUniqueOrThrow({
            where: { id: stale.record.id },
          })
        ).consumedAt
      ).toBeNull()
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .password
      ).toBe(passwordHash)
    })

    it('never adds a local password to an SSO-only account and refuses ambiguous legacy addresses', async () => {
      const account = await user({
        password: null,
        oidcSubject: `issuer|${randomUUID()}`,
      })
      await requestPasswordReset(account.email!, config)
      expect(
        await prisma.emailToken.count({ where: { userId: account.id } })
      ).toBe(0)
      const local = await user()
      await user({
        email: local.email!.toUpperCase(),
        emailVerifiedFor: local.email!.toUpperCase(),
      })
      await requestPasswordReset(local.email!, config)
      expect(
        await prisma.emailToken.count({ where: { userId: local.id } })
      ).toBe(0)
    })

    it('requires both mailboxes when configured and keeps the new-address link usable after early confirmation', async () => {
      config.changes.requireOldEmail = true
      await persistConfig(config)
      const newEmail = `${randomUUID()}@new.example`
      const account = await user({
        pendingEmail: newEmail,
        pendingEmailOldConfirmed: false,
      })
      const change = await token(account, 'change', newEmail)
      const approval = await token(account, 'change_approval')
      await expect(confirmEmailToken(change.token, config)).rejects.toThrow(
        'Approve the change'
      )
      expect(
        (
          await prisma.emailToken.findUniqueOrThrow({
            where: { id: change.record.id },
          })
        ).consumedAt
      ).toBeNull()
      await confirmEmailToken(approval.token, config)
      await confirmEmailToken(change.token, config)
      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
      })
      expect(updated.email).toBe(newEmail)
      expect(updated.emailVerifiedFor).toBe(newEmail)
      expect(updated.pendingEmail).toBeNull()
      expect(updated.sessionVersion).toBe(account.sessionVersion + 1)
      await expect(confirmEmailToken(change.token, config)).rejects.toThrow(
        'invalid or expired'
      )
    })

    it('serializes case-insensitive address claims across different users', async () => {
      const email = `${randomUUID()}@new.example`
      const a = await user({
        pendingEmail: email,
        pendingEmailOldConfirmed: true,
      })
      const b = await user({
        pendingEmail: email.toUpperCase(),
        pendingEmailOldConfirmed: true,
      })
      const first = await token(a, 'change', email)
      const second = await token(b, 'change', email.toUpperCase())
      const results = await Promise.allSettled([
        confirmEmailToken(first.token, config),
        confirmEmailToken(second.token, config),
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1)
      expect(
        await prisma.user.count({
          where: { email: { equals: email, mode: 'insensitive' } },
        })
      ).toBe(1)
    })

    it('does not fabricate old-address approval when the policy makes it optional', async () => {
      const account = await user()
      state.session = { user: { id: account.id } }
      const email = `${randomUUID()}@new.example`
      const response = await changeEmail(
        request({ email, password: 'old-password' })
      )
      expect(response.status).toBe(200)
      const pending = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
      })
      expect(pending.pendingEmailOldConfirmed).toBe(false)
      expect(
        await prisma.emailToken.count({
          where: { userId: account.id, purpose: 'change_approval' },
        })
      ).toBe(0)
      await confirmEmailToken(await changeLink(account.id), config)
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .email
      ).toBe(email)
    })

    it('requires real old-address approval when an administrator tightens policy during a pending change', async () => {
      const account = await user()
      state.session = { user: { id: account.id } }
      const email = `${randomUUID()}@new.example`
      expect(
        (await changeEmail(request({ email, password: 'old-password' }))).status
      ).toBe(200)
      const staleConfig = structuredClone(config)
      const link = await changeLink(account.id)
      config.changes.requireOldEmail = true
      await persistConfig(config)
      await expect(confirmEmailToken(link, staleConfig)).rejects.toThrow(
        'Start the email change again'
      )
      const pending = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
      })
      expect(pending.email).toBe(account.email)
      expect(pending.pendingEmail).toBe(email)
      expect(pending.pendingEmailOldConfirmed).toBe(false)
      expect(
        await prisma.emailToken.count({
          where: { userId: account.id, purpose: 'change', consumedAt: null },
        })
      ).toBe(1)

      // Restart under the new policy; the endpoint now sends both confirmations.
      const cooldownKey = createHash('sha256')
        .update(`email:cooldown:${email}`)
        .digest('hex')
      await prisma.emailRateLimit.update({
        where: { key: cooldownKey },
        data: { resetAt: new Date(0) },
      })
      expect(
        (await changeEmail(request({ email, password: 'old-password' }))).status
      ).toBe(200)
      const newLink = await changeLink(account.id)
      await expect(confirmEmailToken(newLink, config)).rejects.toThrow(
        'Approve the change'
      )
      await confirmEmailToken(
        await changeLink(account.id, 'change_approval'),
        config
      )
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .pendingEmailOldConfirmed
      ).toBe(true)
      await confirmEmailToken(newLink, config)
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .email
      ).toBe(email)
    })

    it('waits for a concurrent settings transaction before deciding whether old-address approval is required', async () => {
      const account = await user()
      state.session = { user: { id: account.id } }
      const email = `${randomUUID()}@new.example`
      expect(
        (await changeEmail(request({ email, password: 'old-password' }))).status
      ).toBe(200)
      const link = await changeLink(account.id)
      let release!: () => void
      let ready!: () => void
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      const locked = new Promise<void>((resolve) => {
        ready = resolve
      })
      const settings = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
          await persistConfig(
            {
              ...config,
              changes: { ...config.changes, requireOldEmail: true },
            },
            tx
          )
          ready()
          await blocked
        },
        { timeout: 10000 }
      )
      await locked
      const confirmation = confirmEmailToken(link, config)
      const outcome = confirmation.then(
        () => null,
        (error: Error) => error
      )
      try {
        await waitForSettingsLockWaiter()
      } finally {
        release()
        await settings
      }
      expect((await outcome)?.message).toContain('Start the email change again')
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .email
      ).toBe(account.email)
    })

    it('can rotate upload credentials and completes recovery when the notification quota is exhausted', async () => {
      config.recovery.rotateUploadToken = true
      config.limits.dailyLimit = 1
      await persistConfig(config)
      const account = await user()
      await exhaustDailyQuota()
      const reset = await token(account)
      await resetPassword(reset.token, 'new-password', config)
      const updated = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
      })
      expect(updated.uploadToken).not.toBe(account.uploadToken)
      expect(await compare('new-password', updated.password!)).toBe(true)
    })

    it('enforces verification for bearer uploads and immediately preserves access when disabled', async () => {
      const account = await user({
        emailVerifiedFor: null,
        emailVerificationSource: null,
      })
      config.verification.mode = 'all_users'
      const req = new Request('https://flare.example/api/files', {
        headers: { authorization: `Bearer ${account.uploadToken}` },
      })
      expect(await getAuthenticatedUser(req)).toBeNull()
      config.enabled = false
      expect((await getAuthenticatedUser(req))?.id).toBe(account.id)
    })

    it('rolls back account creation when required verification cannot enter the outbox', async () => {
      config.verification.mode = 'new_users'
      config.verification.requiredSince = new Date(0).toISOString()
      config.limits.dailyLimit = 1
      await user()
      await exhaustDailyQuota()
      const address = `${randomUUID()}@signup.example`
      const response = await register(
        request({
          email: address,
          name: 'New user',
          password: 'signup-password',
        })
      )
      expect(response.status).toBe(500)
      expect(
        await prisma.user.findUnique({ where: { email: address } })
      ).toBeNull()
      expect(await prisma.emailToken.count({ where: { email: address } })).toBe(
        0
      )
    })
    it('blocks issuing and consuming local reset links after SSO enforcement is enabled', async () => {
      const account = await user()
      const reset = await token(account)
      state.enforceSso = true
      await persistConfig(config)
      // Simulate a request whose earlier ordinary config read is already stale.
      state.enforceSso = false
      await requestPasswordReset(account.email!, config)
      expect(
        await prisma.emailToken.count({ where: { userId: account.id } })
      ).toBe(1)
      await expect(
        resetPassword(reset.token, 'new-password', config)
      ).rejects.toThrow('recovery is disabled')
      expect(
        (
          await prisma.emailToken.findUniqueOrThrow({
            where: { id: reset.record.id },
          })
        ).consumedAt
      ).toBeNull()
    })

    it('keeps the last admin exemption even while an all-user grace period permits temporary access', async () => {
      config.verification.mode = 'all_users'
      config.verification.graceEndsAt = new Date(
        Date.now() + 86400000
      ).toISOString()
      const account = await user({
        roles: { connect: { systemKey: 'administrator' } },
        emailExempt: true,
        emailVerifiedFor: null,
        emailVerificationSource: null,
      })
      await persistConfig(config)
      state.session = {
        user: { id: account.id, permissions: ['administrator'] },
      }
      const response = await adminEmail(request({ action: 'require' }), {
        params: Promise.resolve({ id: account.id }),
      })
      expect(response.status).toBe(409)
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .emailExempt
      ).toBe(true)
    })

    it('does not issue or consume reset tokens using a stale enabled policy', async () => {
      const account = await user()
      const reset = await token(account)
      await persistConfig({ ...config, enabled: false })
      await requestPasswordReset(account.email!, config)
      expect(
        await prisma.emailToken.count({ where: { userId: account.id } })
      ).toBe(1)
      await expect(
        resetPassword(reset.token, 'new-password', config)
      ).rejects.toThrow('recovery is disabled')
      expect(
        (
          await prisma.emailToken.findUniqueOrThrow({
            where: { id: reset.record.id },
          })
        ).consumedAt
      ).toBeNull()
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .password
      ).toBe(passwordHash)
    })

    it('applies the current upload-token rotation policy when a reset request has an older snapshot', async () => {
      const account = await user()
      const reset = await token(account)
      await persistConfig({
        ...config,
        recovery: { ...config.recovery, rotateUploadToken: true },
      })
      await resetPassword(reset.token, 'new-password', config)
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
          .uploadToken
      ).not.toBe(account.uploadToken)
    })

    it('accepts the configured external origin behind a proxy and rejects an unrelated origin', async () => {
      const account = await user()
      state.session = { user: { id: account.id } }
      const good = new Request('http://internal:3000/api/auth/email/enroll', {
        method: 'POST',
        headers: {
          origin: 'https://flare.example',
          'Content-Type': 'application/json',
          'x-real-ip': randomUUID(),
        },
        body: JSON.stringify({ password: 'old-password' }),
      })
      expect((await enroll(good)).status).toBe(200)
      const bad = new Request('http://internal:3000/api/auth/email/enroll', {
        method: 'POST',
        headers: {
          origin: 'https://unrelated.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'old-password' }),
      })
      expect((await enroll(bad)).status).toBe(403)
    })
  }
)
