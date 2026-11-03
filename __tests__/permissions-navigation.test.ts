import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DashboardNav } from '@/components/dashboard/nav'
import { dashboardNavigation } from '@/components/dashboard/navigation'
import { UserNav } from '@/components/dashboard/user-nav'
import { PermissionGate } from '@/components/roles/permission-gate'

const mocks = vi.hoisted(() => ({
  user: {
    name: 'Alex Rivera',
    email: 'alex@example.test',
    image: null,
    permissions: [] as string[],
  },
  pathname: '/dashboard',
  loading: false,
}))
vi.mock('next-auth/react', () => ({
  useSession: () =>
    mocks.loading
      ? { data: undefined, status: 'loading' }
      : { data: { user: mocks.user }, status: 'authenticated' },
  signOut: vi.fn(),
}))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('@/components/customization/instance-brand', () => ({
  InstanceBrand: () => React.createElement('span', null, 'Flare'),
}))

const adminPages = ['users', 'roles', 'settings', 'audit']
const labels = (items: { label: string }[]) => items.map((item) => item.label)
const render = (permissions: string[], pathname = '/dashboard') => {
  mocks.user.permissions = permissions
  mocks.pathname = pathname
  return renderToStaticMarkup(React.createElement(DashboardNav))
}

describe('permission-aware dashboard navigation', () => {
  it('orders everyday places first and administration pages after them', () => {
    const { workspace, admin } = dashboardNavigation({
      permissions: ['administrator'],
    })
    expect(labels(workspace)).toEqual(['Files', 'Upload', 'Paste', 'Links'])
    expect(labels(admin)).toEqual(['Users', 'Roles', 'Audit log', 'Settings'])
    expect(admin.every((item) => item.hint.length > 0)).toBe(true)
  })

  it('keeps profile accessible when no product permissions are granted', () => {
    const html = render([])
    // The brand goes to Profile; there is nothing else to navigate to.
    expect(html).toContain('href="/dashboard/profile"')
    expect(html).not.toContain('Open navigation')
    expect(html).not.toContain('href="/dashboard/upload"')
    for (const page of adminPages)
      expect(html).not.toContain(`/dashboard/${page}"`)
  })

  it('keeps the menu button in place while the session loads', () => {
    mocks.loading = true
    try {
      expect(render([])).toContain('Open navigation')
    } finally {
      mocks.loading = false
    }
    expect(render([])).not.toContain('Open navigation')
  })

  it('moves Profile out of the bar and into the account menu', () => {
    const html = render(['files.read', 'files.upload', 'links.read'])
    expect(html).toContain('href="/dashboard"')
    expect(html).not.toContain('>Profile<')
    mocks.pathname = '/dashboard/profile'
    const account = renderToStaticMarkup(React.createElement(UserNav))
    expect(account).toContain('aria-label="Account menu"')
    expect(account).toContain('aria-haspopup="menu"')
    expect(account).toContain('aria-current="true"')
  })

  it('describes Users by what the viewer can do there', () => {
    const hint = (permissions: string[]) =>
      dashboardNavigation({ permissions }).admin.find(
        (item) => item.label === 'Users'
      )?.hint
    expect(hint(['users.read'])).toBe('Accounts on this instance')
    expect(hint(['users.read', 'invites.create'])).toBe(
      'Accounts and invite links'
    )
    expect(hint(['users.read', 'invites.manage'])).toBe(
      'Accounts and invite links'
    )
    expect(hint(['administrator'])).toBe('Accounts and invite links')
  })

  it('groups two or more administration pages under one Admin menu', () => {
    const html = render(['users.read', 'roles.manage'])
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('>Admin<')
    // The menu renders its links only when opened.
    expect(html).not.toContain('href="/dashboard/users"')
    expect(html).not.toContain('href="/dashboard/roles"')
    expect(
      labels(
        dashboardNavigation({ permissions: ['users.read', 'roles.manage'] })
          .admin
      )
    ).toEqual(['Users', 'Roles'])
  })

  it('marks the Admin menu current on the pages it holds', () => {
    const adminButton = (html: string) =>
      html.match(/<button[^>]*aria-haspopup="menu"[^>]*>/)?.[0] ?? ''
    expect(
      adminButton(render(['administrator'], '/dashboard/settings'))
    ).toContain('aria-current="true"')
    expect(adminButton(render(['administrator'], '/dashboard'))).not.toContain(
      'aria-current'
    )
  })

  it('shows a single administration page as an ordinary link', () => {
    const html = render(['audit.read'], '/dashboard/audit')
    expect(html).toContain('href="/dashboard/audit"')
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('>Admin<')
    expect(html).not.toContain('href="/dashboard/users"')
    expect(html).not.toContain('href="/dashboard/settings"')
  })

  it('requires upload and paste permissions for the paste workflow', () => {
    expect(render(['pastes.create'])).not.toContain('href="/dashboard/paste"')
    expect(render(['pastes.create', 'files.upload'])).toContain(
      'href="/dashboard/paste"'
    )
  })

  it('fits four places from tablet width and more from 900px', () => {
    const member = render([
      'files.read',
      'files.upload',
      'pastes.create',
      'links.read',
    ])
    expect(member).toContain('md:flex')
    expect(member).not.toContain('min-[900px]:flex')
    const administrator = render(['administrator'])
    expect(administrator).toContain('min-[900px]:flex')
    expect(administrator).not.toContain('md:flex')
  })

  it('grants administrators access to every navigation destination', () => {
    const { workspace, admin } = dashboardNavigation({
      permissions: ['administrator'],
    })
    expect([...workspace, ...admin].map((item) => item.href)).toEqual([
      '/dashboard',
      '/dashboard/upload',
      '/dashboard/paste',
      '/dashboard/urls',
      '/dashboard/users',
      '/dashboard/roles',
      '/dashboard/audit',
      '/dashboard/settings',
    ])
  })

  it('does not render or mount controls without their permission', () => {
    const sensitiveControl = vi.fn(() =>
      React.createElement('button', null, 'Delete content')
    )
    mocks.user.permissions = ['content.read']
    const html = renderToStaticMarkup(
      React.createElement(PermissionGate, {
        permission: 'content.delete',
        children: React.createElement(sensitiveControl),
      })
    )
    expect(html).toBe('')
    expect(sensitiveControl).not.toHaveBeenCalled()
    mocks.user.permissions = ['content.delete']
    expect(
      renderToStaticMarkup(
        React.createElement(PermissionGate, {
          permission: 'content.delete',
          children: React.createElement(sensitiveControl),
        })
      )
    ).toContain('Delete content')
  })
})
