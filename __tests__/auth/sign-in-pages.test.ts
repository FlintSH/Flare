import LoginPage from '@/app/(main)/auth/login/page'
import RegisterPage from '@/app/(main)/auth/register/page'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmailCapabilities } from '@/lib/email/eligibility'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  findFirst: vi.fn(),
  cookies: new Map<string, string>(),
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
// The login page reads one cookie; these tests render it outside a request.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.cookies.has(name)
        ? { name, value: mocks.cookies.get(name) }
        : undefined,
  }),
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
const recoveryLink = 'Forgot your password?'
const agentNotice = 'Sign in to connect an agent to this account.'
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
  mocks.cookies.clear()
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

  it("say that an agent's sign-in is waiting, only while one is", async () => {
    expect(await login()).not.toContain(agentNotice)
    mocks.cookies.set('flare_oauth_pending', '1')
    const page = await login()
    expect(page).toContain(agentNotice)
    // Above the form, which is otherwise as it was.
    expect(page.indexOf(agentNotice)).toBeLessThan(page.indexOf('<form'))
    expect(page).toContain(recoveryLink)
    // Only the value the authorize endpoint sets counts.
    mocks.cookies.set('flare_oauth_pending', '')
    expect(await login()).not.toContain(agentNotice)
  })
})
