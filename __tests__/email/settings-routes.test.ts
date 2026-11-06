import { GET as impact } from '@/app/api/settings/email/impact/route'
import { PUT } from '@/app/api/settings/email/route'
import { POST as test } from '@/app/api/settings/email/test/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { getEmailConfigForUpdate } from '@/lib/email/config'
import { EmailHttpError } from '@/lib/email/errors'
import { MailLimitError } from '@/lib/email/outbox'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'admin', permissions: ['settings.email'] },
  }),
}))
vi.mock('@/lib/email/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/config')>()),
  saveEmailConfig: mocks.save,
  prepareEmailConfig: async (candidate: unknown) => ({ candidate }),
}))
vi.mock('@/lib/email/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/transport')>()),
  sendTestEmail: mocks.send,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    mailOutbox: {
      groupBy: async () => [],
      findMany: async () => [],
    },
  },
}))
// Nothing saved: the email settings are the defaults and the environment.
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  readSavedConfigRow: async () => null,
}))

const put = (body: unknown) =>
  PUT(
    new Request('https://flare.test/api/settings/email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('email settings routes', () => {
  it('words settings the form sent wrong with their paths', async () => {
    for (const body of [
      { config: { smtp: { port: 0 } } },
      { config: { smtp: { port: 0 } }, clearPassword: 'yes' },
    ]) {
      const response = await put(body)
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/^smtp\.port: /)
    }
    const empty = await put(null)
    expect(empty.status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('sends the messages written for the administrator, and nothing an environment caused', async () => {
    const enable = await test(
      new Request('https://flare.test/api/settings/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connection', config: {} }),
      })
    )
    expect(enable.status).toBe(400)
    expect(await enable.json()).toEqual({
      error:
        'SMTP host, sender address, and public instance URL are required to enable email',
    })

    const logged = vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    mocks.save.mockRejectedValue(
      new Error('FLARE_EMAIL_SMTP_PORT must be an integer')
    )
    const environment = await put({ config: {} })
    expect(environment.status).toBe(500)
    expect(await environment.json()).toEqual({
      error: 'Could not update email settings',
    })
    expect(logged).toHaveBeenCalledOnce()
  })

  it('answers effective settings the environment makes unusable with a logged 500', async () => {
    vi.stubEnv('FLARE_EMAIL_ENABLED', 'true')
    const logged = vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    const response = await impact(
      new Request('https://flare.test/api/settings/email/impact')
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Could not update email settings',
    })
    expect(logged).toHaveBeenCalledOnce()
    const unusable = (error: unknown) =>
      error instanceof Error &&
      !(error instanceof HttpError) &&
      error.cause instanceof EmailHttpError &&
      error.message ===
        'SMTP host, sender address, and public instance URL are required to enable email'
    expect(unusable(logged.mock.calls[0][1])).toBe(true)
    // Account changes read them under the settings lock, with the same result.
    const tx = {
      $executeRaw: async () => 0,
      config: { findUnique: async () => null },
    }
    const locked = await getEmailConfigForUpdate(tx as never).catch(
      (error: unknown) => error
    )
    expect(unusable(locked)).toBe(true)
  })

  it('answers anything else with a logged 500 that names no internals', async () => {
    const logged = vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    for (const failure of [
      new TypeError("Cannot read properties of undefined (reading 'smtp')"),
      // Saved settings the schema rejects are the server's problem.
      z.object({ smtp: z.string() }).safeParse({}).error,
    ]) {
      mocks.save.mockRejectedValue(failure)
      const response = await put({ config: {} })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Could not update email settings',
      })
    }
    expect(logged).toHaveBeenCalledTimes(2)
  })

  it('asks for a test recipient and passes a full daily cap through', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'a'.repeat(32))
    const send = (recipient?: string) =>
      test(
        new Request('https://flare.test/api/settings/email/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send',
            recipient,
            config: {
              smtp: { host: 'smtp.example.com', authentication: false },
              fromAddress: 'flare@example.com',
              publicUrl: 'https://flare.example.com',
            },
          }),
        })
      )
    const missing = await send()
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({
      error: 'A test recipient is required',
    })
    mocks.send.mockRejectedValue(new MailLimitError())
    const capped = await send('admin@example.com')
    expect(capped.status).toBe(400)
    expect(await capped.json()).toEqual({
      error:
        'The daily email sending limit has been reached. Try again tomorrow or contact your administrator.',
    })
  })
})
