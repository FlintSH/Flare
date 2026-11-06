import { requireDashboardPage } from '@/app/(main)/dashboard/page-access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type DashboardPage,
  canOpen,
  canSeeInvites,
  dashboardHome,
  dashboardNavigation,
} from '@/components/dashboard/navigation'

const session = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
vi.mock('@/lib/auth/page-session', () => ({ getPageSession: session }))

const signedIn = (...permissions: string[]) =>
  session.mockResolvedValue({ user: { id: 'member', permissions, roles: [] } })

const everyPage = (): DashboardPage[] => {
  const { workspace, admin } = dashboardNavigation({
    permissions: ['administrator'],
  })
  return [...workspace, ...admin].map((item) => item.href as DashboardPage)
}

beforeEach(() => session.mockReset())

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
