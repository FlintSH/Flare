import { createElement } from 'react'

import MissingDashboardPage from '@/app/(main)/dashboard/[...missing]/page'
import DashboardLayout from '@/app/(main)/dashboard/layout'
import DashboardNotFound from '@/app/(main)/dashboard/not-found'
import { requireDashboardPage } from '@/app/(main)/dashboard/page-access'
import type { Session } from 'next-auth'
import { SessionProvider } from 'next-auth/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type DashboardPage,
  canOpen,
  canSeeInvites,
  dashboardHome,
  dashboardNavigation,
} from '@/components/dashboard/navigation'

const session = vi.hoisted(() => vi.fn())
const config = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
  notFound: () => {
    throw new Error('not-found:404')
  },
}))
vi.mock('@/lib/auth/page-session', () => ({ getPageSession: session }))
vi.mock('@/lib/config', () => ({ getConfig: config }))
vi.mock('@/components/dashboard/dashboard-wrapper', () => ({
  DashboardWrapper: ({ children }: { children: unknown }) => children,
}))

const signedIn = (...permissions: string[]) =>
  session.mockResolvedValue({ user: { id: 'member', permissions, roles: [] } })

const everyPage = (): DashboardPage[] => {
  const { workspace, admin } = dashboardNavigation({
    permissions: ['administrator'],
  })
  return [...workspace, ...admin].map((item) => item.href as DashboardPage)
}

beforeEach(() => {
  session.mockReset()
  config.mockReset()
  config.mockResolvedValue({
    settings: {
      general: {
        credits: { showFooter: true },
        storage: { maxUploadSize: { value: 100, unit: 'MB' } },
      },
    },
  })
})

describe('dashboard page access', () => {
  it.each(everyPage())(
    'sends a signed-out visitor from %s to sign-in',
    async (href) => {
      session.mockResolvedValue(null)
      await expect(requireDashboardPage(href)).rejects.toThrow(
        'redirect:/auth/login'
      )
    }
  )

  it.each(everyPage())(
    'sends someone whose roles do not allow %s to Profile',
    async (href) => {
      signedIn()
      await expect(requireDashboardPage(href)).rejects.toThrow(
        'redirect:/dashboard/profile'
      )
    }
  )

  it('sends people without users.read from Users to Profile, like the other pages', async () => {
    signedIn('files.read')
    await expect(requireDashboardPage('/dashboard/users')).rejects.toThrow(
      'redirect:/dashboard/profile'
    )
  })

  it('opens a page with exactly the permissions the navigation lists for it', async () => {
    signedIn('pastes.create')
    await expect(requireDashboardPage('/dashboard/paste')).rejects.toThrow(
      'redirect:/dashboard/profile'
    )
    signedIn('pastes.create', 'files.upload')
    const opened = await requireDashboardPage('/dashboard/paste')
    expect(opened.user.id).toBe('member')
    expect(canOpen({ permissions: [] }, '/dashboard/profile')).toBe(true)
  })

  it('leads the brand to Files, or to Profile without files.read', () => {
    expect(dashboardHome({ permissions: ['files.read'] })).toBe('/dashboard')
    expect(dashboardHome({ permissions: ['files.upload'] })).toBe(
      '/dashboard/profile'
    )
  })

  it('shows the Invites tab to people who can invite or review invites', () => {
    expect(canSeeInvites({ permissions: ['users.read'] })).toBe(false)
    expect(canSeeInvites({ permissions: ['invites.create'] })).toBe(true)
    expect(canSeeInvites({ permissions: ['invites.manage'] })).toBe(true)
  })
})

describe('dashboard layout access before its loading boundary', () => {
  it('requires sign-in before reading configuration or rendering the shell', async () => {
    session.mockResolvedValue(null)
    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      'redirect:/auth/login'
    )
    expect(config).not.toHaveBeenCalled()
  })

  it('preserves required-email verification before reading configuration', async () => {
    const redirect = new Error('redirect:/auth/verify-email')
    session.mockRejectedValue(redirect)
    await expect(DashboardLayout({ children: null })).rejects.toBe(redirect)
    expect(config).not.toHaveBeenCalled()
  })

  it.each([
    { permissions: [] },
    { permissions: ['files.upload'] },
    { permissions: ['files.read'] },
  ])(
    'allows a signed-in account through the universal guard: $permissions',
    async ({ permissions }) => {
      signedIn(...permissions)
      const element = await DashboardLayout({ children: 'Workspace content' })
      expect(renderToStaticMarkup(element)).toContain('Workspace content')
      expect(config).toHaveBeenCalledTimes(1)
    }
  )
})

const renderMissing = (permissions?: Session['user']['permissions']) =>
  renderToStaticMarkup(
    createElement(SessionProvider, {
      session: permissions
        ? {
            expires: '2099-01-01T00:00:00Z',
            user: {
              id: 'member',
              name: 'Demo Member',
              email: 'member@example.test',
              image: null,
              permissions,
              roles: [],
            },
          }
        : undefined,
      children: createElement(DashboardNotFound),
    })
  )

describe('missing dashboard pages', () => {
  it('interrupts synchronously so an unknown address is a not-found route', () => {
    expect(() => MissingDashboardPage()).toThrow('not-found:404')
    expect(session).not.toHaveBeenCalled()
  })

  it('server-renders the Files destination from the actual preloaded SessionProvider', () => {
    const html = renderMissing(['files.read'])
    expect(html).toContain('Page not found')
    expect(html).toContain('href="/dashboard"')
    expect(html).toContain('Go to your files')
  })

  it.each<{ permissions: Session['user']['permissions'] }>([
    { permissions: [] },
    { permissions: ['files.upload'] },
    { permissions: ['audit.read'] },
  ])(
    'returns a role without files.read to Profile: $permissions',
    ({ permissions }) => {
      const html = renderMissing(permissions)
      expect(html).toContain('href="/dashboard/profile"')
      expect(html).toContain('Go to Profile')
      expect(html).not.toContain('Go to your files')
    }
  )

  it('server-renders Profile as the safe destination while a session loads', () => {
    const html = renderMissing()
    expect(html).toContain('href="/dashboard/profile"')
    expect(html).toContain('Go to Profile')
    expect(html).not.toContain('Go to your files')
  })
})
