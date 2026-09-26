import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DashboardNav } from '@/components/dashboard/nav'
import { PermissionGate } from '@/components/roles/permission-gate'

const mocks = vi.hoisted(() => ({ user: { permissions: [] as string[] } }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: mocks.user } }),
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('@/components/customization/instance-brand', () => ({
  InstanceBrand: () => React.createElement('span', null, 'Flare'),
}))

describe('permission-aware dashboard navigation', () => {
  it('keeps profile accessible when no product permissions are granted', () => {
    mocks.user.permissions = []
    const html = renderToStaticMarkup(React.createElement(DashboardNav))
    expect(html).toContain('href="/dashboard/profile"')
    expect(html).not.toContain('href="/dashboard/upload"')
    expect(html).not.toContain('href="/dashboard/users"')
    expect(html).not.toContain('href="/dashboard/roles"')
    expect(html).not.toContain('href="/dashboard/settings"')
  })

  it('shows independently delegated management capabilities', () => {
    mocks.user.permissions = ['users.read', 'roles.manage']
    const html = renderToStaticMarkup(React.createElement(DashboardNav))
    expect(html).toContain('href="/dashboard/users"')
    expect(html).toContain('href="/dashboard/roles"')
    expect(html).not.toContain('href="/dashboard/settings"')
    expect(html).not.toContain('href="/dashboard/upload"')
  })

  it('requires upload and paste permissions for the paste workflow', () => {
    mocks.user.permissions = ['pastes.create']
    expect(
      renderToStaticMarkup(React.createElement(DashboardNav))
    ).not.toContain('href="/dashboard/paste"')
    mocks.user.permissions.push('files.upload')
    expect(renderToStaticMarkup(React.createElement(DashboardNav))).toContain(
      'href="/dashboard/paste"'
    )
  })

  it('grants administrators access to every navigation destination', () => {
    mocks.user.permissions = ['administrator']
    const html = renderToStaticMarkup(React.createElement(DashboardNav))
    for (const destination of [
      'upload',
      'paste',
      'urls',
      'users',
      'roles',
      'settings',
    ]) {
      expect(html).toContain(`href="/dashboard/${destination}"`)
    }
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
