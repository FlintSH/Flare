import {
  Activity,
  FileText,
  FolderOpen,
  LinkIcon,
  type LucideIcon,
  Settings,
  Shield,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'

import { ACTION_PERMISSIONS } from '@/lib/permissions/actions'
import {
  type Permission,
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'

export interface NavigationItem {
  href: string
  label: string
  icon: LucideIcon
  /** Every listed permission is required. */
  permissions: readonly Permission[]
}

export interface AdminNavigationItem extends NavigationItem {
  /** A few words under the label in the Admin menu. */
  hint: string
}

type Subject = PermissionSubject | null | undefined

/** Your own files and tools. Each gets its own place in the bar. */
const WORKSPACE_ITEMS = [
  {
    href: '/dashboard',
    label: 'Files',
    icon: FolderOpen,
    permissions: ACTION_PERMISSIONS.viewFiles,
  },
  {
    href: '/dashboard/upload',
    label: 'Upload',
    icon: Upload,
    permissions: ACTION_PERMISSIONS.uploadFiles,
  },
  {
    href: '/dashboard/paste',
    label: 'Paste',
    icon: FileText,
    permissions: ACTION_PERMISSIONS.createPaste,
  },
  {
    href: '/dashboard/urls',
    label: 'Links',
    icon: LinkIcon,
    permissions: ACTION_PERMISSIONS.viewLinks,
  },
] as const satisfies readonly NavigationItem[]

/**
 * Instance administration. Two or more of these share the Admin menu; a
 * single one sits in the bar on its own.
 */
const ADMIN_ITEMS = [
  {
    href: '/dashboard/users',
    label: 'Users',
    hint: (user: Subject) =>
      canSeeInvites(user)
        ? 'Accounts and invite links'
        : 'Accounts on this instance',
    icon: Users,
    permissions: ['users.read'],
  },
  {
    href: '/dashboard/roles',
    label: 'Roles',
    hint: 'Permission groups',
    icon: Shield,
    permissions: ['roles.manage'],
  },
  {
    href: '/dashboard/audit',
    label: 'Audit log',
    hint: 'Who did what, and when',
    icon: Activity,
    permissions: ['audit.read'],
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    hint: 'Access, storage, and branding',
    icon: Settings,
    permissions: ['settings.read'],
  },
] as const satisfies readonly (Omit<AdminNavigationItem, 'hint'> & {
  hint: string | ((user: Subject) => string)
})[]

/** Everyone has Profile; it lives in the account menu, not the bar. */
export const PROFILE_ITEM = {
  href: '/dashboard/profile',
  label: 'Profile',
  icon: UserRound,
  permissions: [],
} as const satisfies NavigationItem

const PAGES = [...WORKSPACE_ITEMS, ...ADMIN_ITEMS, PROFILE_ITEM]
export type DashboardPage = (typeof PAGES)[number]['href']

const allowed = (user: Subject, item: NavigationItem) =>
  item.permissions.every((permission) => hasPermission(user, permission))

/** Whether this person's roles allow the page at `href`. */
export function canOpen(user: Subject, href: DashboardPage) {
  const page = PAGES.find((item) => item.href === href)
  if (!page) throw new Error(`${href} is not a dashboard page`)
  return allowed(user, page)
}

/** Where the brand leads: Files, or Profile for people who can't open Files. */
export function dashboardHome(user: Subject): DashboardPage {
  return canOpen(user, '/dashboard') ? '/dashboard' : PROFILE_ITEM.href
}

/** The Users page has an Invites tab for people who can invite or review invites. */
export function canSeeInvites(user: Subject) {
  return (
    hasPermission(user, 'invites.create') ||
    hasPermission(user, 'invites.manage')
  )
}

/** The pages this person can open, in display order. */
export function dashboardNavigation(user: Subject): {
  workspace: NavigationItem[]
  admin: AdminNavigationItem[]
} {
  return {
    workspace: WORKSPACE_ITEMS.filter((item) => allowed(user, item)),
    admin: ADMIN_ITEMS.filter((item) => allowed(user, item)).map(
      (item): AdminNavigationItem => ({
        ...item,
        hint: typeof item.hint === 'function' ? item.hint(user) : item.hint,
      })
    ),
  }
}

export function isCurrentPage(pathname: string | null, href: string) {
  return pathname === href
}
