import type { ReactElement } from 'react'

import HomePage from '@/app/(main)/page'
import SetupPage from '@/app/(main)/setup/page'
import { GET } from '@/app/api/setup/check/route'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SetupWizard } from '@/components/setup/setup-wizard'

import { configureAuditWriter } from '@/lib/audit'
import { loggers } from '@/lib/logger'
import { isSetupComplete } from '@/lib/setup/status'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  session: vi.fn(),
}))

vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findFirst: mocks.findFirst } },
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAuthOptions: async () => ({}),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
}))
vi.mock('@/components/setup/setup-wizard', () => ({ SetupWizard: () => null }))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: async () => ({ enabled: true, recovery: { enabled: false } }),
}))

const outage = new Prisma.PrismaClientInitializationError(
  "Can't reach database server at `db:5432`",
  '6.19.3',
  'P1001'
)
const admin = { user: { id: 'admin', permissions: ['administrator'] } }
const check = () => GET(new Request('http://localhost/api/setup/check'))

beforeEach(() => {
  vi.clearAllMocks()
  configureAuditWriter(vi.fn())
  mocks.findFirst.mockResolvedValue({ id: 'admin' })
  mocks.session.mockResolvedValue(null)
})

describe('setup status', () => {
  it('treats any account as completed setup', async () => {
    expect(await isSetupComplete()).toBe(true)
    mocks.findFirst.mockResolvedValue(null)
    expect(await isSetupComplete()).toBe(false)
    expect(mocks.findFirst).toHaveBeenCalledWith({ select: { id: true } })
  })

  it('decides inside the transaction it is given', async () => {
    const tx = { user: { findFirst: vi.fn().mockResolvedValue(null) } }
    expect(
      await isSetupComplete(tx as unknown as Prisma.TransactionClient)
    ).toBe(false)
    expect(tx.user.findFirst).toHaveBeenCalledOnce()
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })

  it('passes a database error on instead of reporting a new instance', async () => {
    mocks.findFirst.mockRejectedValue(outage)
    await expect(isSetupComplete()).rejects.toBe(outage)
  })
})

describe('GET /api/setup/check', () => {
  it('reports whether setup is complete', async () => {
    let response = await check()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ completed: true })
    mocks.findFirst.mockResolvedValue(null)
    response = await check()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ completed: false })
  })

  it('answers 503 rather than "not set up" while the database is unreachable', async () => {
    const log = vi.spyOn(loggers.startup, 'error').mockImplementation(() => {})
    mocks.findFirst.mockRejectedValue(outage)
    const response = await check()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Setup status is temporarily unavailable',
    })
    expect(log).toHaveBeenCalledWith('GET /api/setup/check failed', outage)
  })
})

describe('pages while the database is unreachable', () => {
  it('sends a new instance from / to setup, and an outage to the error page', async () => {
    mocks.findFirst.mockResolvedValue(null)
    await expect(HomePage()).rejects.toThrow('redirect /setup')
    mocks.findFirst.mockResolvedValue({ id: 'admin' })
    await expect(HomePage()).rejects.toThrow('redirect /auth/login')
    mocks.findFirst.mockRejectedValue(outage)
    await expect(HomePage()).rejects.toBe(outage)
  })

  it('shows the wizard only for a new instance, never during an outage', async () => {
    const page = (step?: string) =>
      SetupPage({ searchParams: Promise.resolve({ step }) }) as Promise<
        ReactElement<Record<string, unknown>>
      >
    mocks.findFirst.mockResolvedValue(null)
    const wizard = await page('ready')
    expect(wizard.type).toBe(SetupWizard)
    expect(wizard.props.resumeStep).toBeUndefined()

    mocks.findFirst.mockResolvedValue({ id: 'admin' })
    await expect(page('ready')).rejects.toThrow(
      'redirect /auth/login?local=1&setupEmail=1&setupStep=ready'
    )
    mocks.session.mockResolvedValue(admin)
    expect((await page('ready')).props.resumeStep).toBe('ready')
    expect((await page('account')).props.resumeStep).toBe('appearance')

    mocks.findFirst.mockRejectedValue(outage)
    await expect(page()).rejects.toBe(outage)
  })
})
