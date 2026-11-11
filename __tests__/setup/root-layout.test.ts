import { type ReactNode, createElement } from 'react'

import RootLayout from '@/app/layout'
import type { Session } from 'next-auth'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, passThrough, nothing } = vi.hoisted(() => ({
  mocks: { findFirst: vi.fn(), session: vi.fn() },
  passThrough: ({ children }: { children?: ReactNode }) => children,
  nothing: () => null,
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-nonce': 'dGVzdC1ub25jZS0xMjM0NTY=' }),
}))
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'inter-variable', className: 'inter' }),
}))
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  const read = async () => actual.DEFAULT_CONFIG
  return { ...actual, getConfig: read, getConfigOrDefaults: read }
})
vi.mock('@/lib/customization/recovery', () => ({
  isAppearanceRecovery: async () => false,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findFirst: mocks.findFirst } },
}))
vi.mock('@/lib/auth/page-session', () => ({
  getRequestSession: mocks.session,
}))
vi.mock('@/components/setup/setup-checker', () => ({
  SetupChecker: ({ completed }: { completed?: boolean }) =>
    createElement('output', { 'data-setup': String(completed) }),
}))
vi.mock('@/components/customization/appearance-provider', () => ({
  AppearanceProvider: passThrough,
}))
vi.mock('@/components/providers/auth-provider', () => ({
  AuthProvider: ({
    session,
    children,
  }: {
    session?: Session | null
    children?: ReactNode
  }) =>
    createElement(
      'section',
      {
        'data-session':
          session === undefined ? 'unknown' : (session?.user.id ?? 'none'),
      },
      children
    ),
}))
vi.mock('@/components/providers/account-keys-provider', () => ({
  AccountKeysProvider: passThrough,
}))
vi.mock('@/components/providers/query-provider', () => ({
  QueryProvider: passThrough,
}))
vi.mock('@/components/theme/theme-provider', () => ({
  ThemeProvider: passThrough,
}))
vi.mock('@/components/layout/custom-head', () => ({ CustomHead: nothing }))
vi.mock('@/components/theme/theme-initializer', () => ({
  ThemeInitializer: nothing,
}))
vi.mock('@/components/providers/input-modality', () => ({
  InputModality: nothing,
}))
vi.mock('@/components/providers/meticulous-context', () => ({
  MeticulousContext: nothing,
}))
vi.mock('@/components/ui/toaster', () => ({ Toaster: nothing }))

async function render() {
  return renderToStaticMarkup(
    await RootLayout({ children: createElement('main', null, 'Your files') })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findFirst.mockResolvedValue({ id: 'admin' })
  mocks.session.mockResolvedValue(null)
})

describe('root layout', () => {
  it('renders the page and hands the server’s setup answer to the browser', async () => {
    for (const [account, completed] of [
      [{ id: 'admin' }, true],
      [null, false],
    ] as const) {
      mocks.findFirst.mockResolvedValue(account)
      const html = await render()
      expect(html).toContain('<main>Your files</main>')
      expect(html).toContain(`data-setup="${completed}"`)
    }
  })

  it('leaves the answer unknown while the database cannot be read', async () => {
    mocks.findFirst.mockRejectedValue(new Error("Can't reach database"))
    const html = await render()
    expect(html).toContain('<main>Your files</main>')
    expect(html).toContain('data-setup="undefined"')
  })

  it('hands the request’s session to the browser, signed in or out', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'alice' } })
    expect(await render()).toContain('data-session="alice"')
    mocks.session.mockResolvedValue(null)
    expect(await render()).toContain('data-session="none"')
  })

  it('lets the browser ask for the session when the server cannot read it', async () => {
    mocks.session.mockRejectedValue(new Error('NEXTAUTH_SECRET is missing'))
    const html = await render()
    expect(html).toContain('<main>Your files</main>')
    expect(html).toContain('data-session="unknown"')
  })
})
