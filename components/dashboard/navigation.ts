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

type Can = (permission: Permission) => boolean

/** Your own files and tools. Each gets its own place in the bar. */
const WORKSPACE_ITEMS: readonly NavigationItem[] = [
  {
    href: '/dashboard',
    label: 'Files',
    icon: FolderOpen,
    permissions: ['files.read'],
  },
  {
    href: '/dashboard/upload',
    label: 'Upload',
    icon: Upload,
    permissions: ['files.upload'],
  },
  {
    href: '/dashboard/paste',
    label: 'Paste',
    icon: FileText,
    permissions: ['pastes.create', 'files.upload'],
  },
  {
    href: '/dashboard/urls',
    label: 'Links',
    icon: LinkIcon,
    permissions: ['links.read'],
  },
]

/**
 * Instance administration. Two or more of these share the Admin menu; a
 * single one sits in the bar on its own.
 */
const ADMIN_ITEMS: readonly (Omit<AdminNavigationItem, 'hint'> & {
  hint: string | ((can: Can) => string)
})[] = [
  {
    href: '/dashboard/users',
    label: 'Users',
    // The Users page has an Invites tab only for people who can invite.
    hint: (can) =>
      can('invites.create') || can('invites.manage')
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
]

/** Everyone has Profile; it lives in the account menu, not the bar. */
export const PROFILE_ITEM: NavigationItem = {
  href: '/dashboard/profile',
  label: 'Profile',
  icon: UserRound,
  permissions: [],
}

/** The pages this person can open, in display order. */
export function dashboardNavigation(
  user: PermissionSubject | null | undefined
) {
  const can: Can = (permission) => hasPermission(user, permission)
  const allowed = (item: NavigationItem) => item.permissions.every(can)
  return {
    workspace: WORKSPACE_ITEMS.filter(allowed),
    admin: ADMIN_ITEMS.filter(allowed).map((item): AdminNavigationItem => ({
      ...item,
      hint: typeof item.hint === 'function' ? item.hint(can) : item.hint,
    })),
  }
}

export function isCurrentPage(pathname: string | null, href: string) {
  return pathname === href
}
