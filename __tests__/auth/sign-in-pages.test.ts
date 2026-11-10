import LoginPage from '@/app/(main)/auth/login/page'
import RegisterPage from '@/app/(main)/auth/register/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmailCapabilities } from '@/lib/email/eligibility'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  const config = structuredClone(actual.DEFAULT_CONFIG)
  config.settings.general.registrations.enabled = true
  return { ...actual, getConfig: async () => config }
})
vi.mock('@/lib/email/config', () => ({
  getEmailCapabilities: mocks.capabilities,
}))
vi.mock('@/lib/invites/service', () => ({ inspectInvite: vi.fn() }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findFirst: mocks.findFirst } },
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
// The forms keep account keys through the provider of the root layout.
vi.mock('@/components/providers/account-keys-provider', () => ({
  KEY_SETUP_PATH: '/auth/encryption',
  useAccountKeys: () => ({ state: { status: 'signed-out' }, adopt: vi.fn() }),
}))
vi.mock('@/components/customization/instance-brand', () => ({
  InstanceBrand: () => null,
}))
vi.mock('@/components/layout/dynamic-background', () => ({
  DynamicBackground: () => null,
}))

const email: EmailCapabilities = {
  enabled: true,
  recoveryEnabled: true,
  verificationMode: 'new_users',
  changesEnabled: false,
}
const recoveryLink = 'Forgot your passphrase?'
const verificationNotice = 'confirm your email before using your account'
const fetch = vi.fn()

const login = async () =>
  renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
const register = async () =>
  renderToStaticMarkup(
    await RegisterPage({ searchParams: Promise.resolve({}) })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetch)
  mocks.capabilities.mockResolvedValue(email)
  mocks.findFirst.mockResolvedValue({ id: 'admin' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sign-in pages', () => {
  it('render the email choices with the page instead of asking afterwards', async () => {
    mocks.capabilities.mockResolvedValue(email)
    expect(await login()).toContain(recoveryLink)
    expect(await register()).toContain(verificationNotice)

    mocks.capabilities.mockResolvedValue({
      ...email,
      recoveryEnabled: false,
      verificationMode: 'off',
    })
    expect(await login()).not.toContain(recoveryLink)
    expect(await register()).not.toContain(verificationNotice)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still render without those choices when the email settings cannot be read', async () => {
    mocks.capabilities.mockRejectedValue(new Error('FLARE_EMAIL_ENABLED'))
    const page = await login()
    expect(page).toContain('Welcome back')
    expect(page).not.toContain(recoveryLink)
    const form = await register()
    expect(form).toContain('Create an account')
    expect(form).not.toContain(verificationNotice)
  })

  it('ask for the address first and for a passphrase when registering, never for a password', async () => {
    const page = await login()
    expect(page).toContain('Email address')
    expect(page).toContain('Continue')
    expect(page).not.toContain('type="password"')
    const form = await register()
    expect(form).toContain('Confirm passphrase')
    expect(form).not.toContain('Confirm password')
  })

  it('send a new instance to setup instead of showing a form', async () => {
    mocks.findFirst.mockResolvedValue(null)
    await expect(login()).rejects.toThrow('REDIRECT /setup')
    await expect(register()).rejects.toThrow('REDIRECT /setup')
  })

  it('still show their forms when the setup status cannot be read', async () => {
    mocks.findFirst.mockRejectedValue(new Error("Can't reach database"))
    expect(await login()).toContain('Welcome back')
    expect(await register()).toContain('Create an account')
  })
})
