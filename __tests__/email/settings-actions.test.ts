import {
  POST as impactDraft,
  GET as impactNow,
} from '@/app/api/settings/email/impact/route'
import { POST as test } from '@/app/api/settings/email/test/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { emailPolicyImpact, testSavedEmailSettings } from '@/lib/email/admin'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { HttpError } from '@/lib/http/errors'

const mocks = vi.hoisted(() => ({
  users: vi.fn(),
  verify: vi.fn(),
  send: vi.fn(),
  saved: null as unknown,
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'admin', permissions: ['settings.email'] },
  }),
}))
vi.mock('@/lib/email/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/transport')>()),
  verifySmtp: mocks.verify,
  sendTestEmail: mocks.send,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findMany: mocks.users } },
}))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  readSavedConfigRow: async () =>
    mocks.saved ? { value: { settings: { email: mocks.saved } } } : null,
}))

const usable = {
  smtp: { host: 'saved.example.com', authentication: false },
  fromAddress: 'flare@example.com',
  publicUrl: 'https://flare.example.com',
}

function post(
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown
) {
  return route(
    new Request(`https://flare.test/api/settings/email/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  configureAuditWriter(async () => {})
  vi.unstubAllEnvs()
  vi.stubEnv('NEXTAUTH_SECRET', 'a'.repeat(32))
  mocks.saved = null
  mocks.verify.mockResolvedValue(undefined)
  mocks.send.mockResolvedValue(undefined)
  const verified = {
    email: 'a@example.com',
    emailVerified: new Date(),
    emailVerifiedFor: 'a@example.com',
  }
  mocks.users.mockResolvedValue([
    { ...verified, emailVerificationSource: 'email', emailExempt: false },
    { ...verified, emailVerificationSource: 'oidc', emailExempt: false },
    {
      email: 'b@example.com',
      emailVerified: null,
      emailVerifiedFor: null,
      emailVerificationSource: null,
      emailExempt: true,
    },
    {
      email: 'c@example.com',
      emailVerified: null,
      emailVerifiedFor: null,
      emailVerificationSource: null,
      emailExempt: false,
    },
  ])
})

describe('email verification impact', () => {
  it('counts unverified accounts and those verification would shut out', async () => {
    const response = await impactNow(
      new Request('https://flare.test/api/settings/email/impact')
    )
    expect(response.status).toBe(200)
    // An OIDC address counts as verified only when OIDC is trusted.
    expect(await response.json()).toEqual({
      data: { unverifiedUsers: 3, affectedUsers: 2 },
    })
  })

  it('counts against a draft without saving it', async () => {
    const response = await post(impactDraft, 'impact', {
      config: { verification: { trustOidc: true } },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { unverifiedUsers: 2, affectedUsers: 1 },
    })
  })
})

describe('email delivery test', () => {
  it('tests the saved connection when no draft is sent', async () => {
    mocks.saved = usable
    const response = await post(test, 'test', { action: 'connection' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { message: 'SMTP connection and authentication succeeded' },
    })
    // Testing works while automatic sending is off.
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        smtp: expect.objectContaining({ host: 'saved.example.com' }),
      })
    )
  })

  it('tests a draft instead of the saved settings when one is sent', async () => {
    mocks.saved = usable
    const response = await post(test, 'test', {
      action: 'connection',
      config: {
        ...usable,
        smtp: { host: 'draft.example.com', authentication: false },
      },
    })
    expect(response.status).toBe(200)
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        smtp: expect.objectContaining({ host: 'draft.example.com' }),
      })
    )
  })

  it('sends one message to the recipient with the saved settings', async () => {
    mocks.saved = usable
    const response = await post(test, 'test', {
      action: 'send',
      recipient: 'admin@example.com',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        message:
          'SMTP server accepted the test message. Check your inbox to confirm delivery.',
      },
    })
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        smtp: expect.objectContaining({ host: 'saved.example.com' }),
      }),
      'admin@example.com'
    )
  })

  it('refuses saved settings that cannot send, before connecting', async () => {
    const response = await post(test, 'test', { action: 'connection' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error:
        'SMTP host, sender address, and public instance URL are required to enable email',
    })
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('asks for a recipient before sending with the saved settings', async () => {
    mocks.saved = usable
    const response = await post(test, 'test', { action: 'send' })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'A test recipient is required',
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('describes provider errors without their details, and passes Flare refusals through', async () => {
    mocks.saved = usable
    mocks.verify.mockRejectedValue(
      Object.assign(new Error('535 bad credentials for secret-user'), {
        code: 'EAUTH',
      })
    )
    const refused = await post(test, 'test', { action: 'connection' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({
      error: 'SMTP authentication failed. Check the username and password.',
    })
    mocks.verify.mockRejectedValue(new HttpError(429, 'Slow down'))
    const limited = await post(test, 'test', { action: 'connection' })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'Slow down' })
  })
})

describe('email settings functions', () => {
  it('counts the impact of any policy it is given', async () => {
    expect(await emailPolicyImpact(DEFAULT_EMAIL_CONFIG)).toEqual({
      unverifiedUsers: 3,
      affectedUsers: 2,
    })
  })

  it('tests the saved settings and answers the message to show', async () => {
    mocks.saved = usable
    expect(await testSavedEmailSettings({ action: 'connection' })).toBe(
      'SMTP connection and authentication succeeded'
    )
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        smtp: expect.objectContaining({ host: 'saved.example.com' }),
      })
    )
  })
})
