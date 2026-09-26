/** Shared by API authorization, navigation, and the role editor. No server imports. */
export const PERMISSION_GROUPS = [
  {
    id: 'files',
    label: 'Files and sharing',
    description: 'Work with your own uploads, pastes, folders, and tags.',
    permissions: [
      {
        key: 'files.read',
        label: 'View files',
        description: 'Browse and download your own files.',
      },
      {
        key: 'files.upload',
        label: 'Upload files',
        description: 'Upload files through the dashboard and integrations.',
      },
      {
        key: 'files.update',
        label: 'Edit files',
        description: 'Organize files and manage their expiration schedules.',
      },
      {
        key: 'files.delete',
        label: 'Delete files',
        description: 'Permanently delete your own files.',
      },
      {
        key: 'files.share',
        label: 'Share files',
        description: 'Change file visibility and sharing protection.',
      },
      {
        key: 'pastes.create',
        label: 'Create pastes',
        description: 'Create text and code pastes; also requires Upload files.',
      },
      {
        key: 'folders.manage',
        label: 'Manage folders',
        description: 'Create, organize, and delete your own folders.',
      },
      {
        key: 'folders.share',
        label: 'Share folders',
        description: 'Create and revoke public folder links.',
      },
      {
        key: 'tags.manage',
        label: 'Manage tags',
        description:
          'Create tags and tagging rules and organize your files with them.',
      },
    ],
  },
  {
    id: 'links',
    label: 'Shortened links',
    description: 'Manage your own shortened URLs.',
    permissions: [
      {
        key: 'links.read',
        label: 'View links',
        description: 'Browse your own shortened URLs and click counts.',
      },
      {
        key: 'links.create',
        label: 'Create links',
        description: 'Create shortened URLs.',
      },
      {
        key: 'links.delete',
        label: 'Delete links',
        description: 'Permanently delete your shortened URLs.',
      },
    ],
  },
  {
    id: 'account',
    label: 'Account and integrations',
    description: 'Personal settings and tools.',
    permissions: [
      {
        key: 'profile.update',
        label: 'Edit profile',
        description: 'Change your profile, avatar, and upload defaults.',
      },
      {
        key: 'profile.export',
        label: 'Export account',
        description:
          'Export your account and content; also requires View files and View shortened links.',
      },
      {
        key: 'uploadProfiles.manage',
        label: 'Manage upload profiles',
        description: 'Create and edit reusable upload presets.',
      },
      {
        key: 'tokens.manage',
        label: 'Manage API tokens',
        description:
          'Create and revoke named API tokens and rotate your legacy upload token. Tokens never exceed your current role permissions.',
      },
      {
        key: 'webhooks.manage',
        label: 'Manage webhooks',
        description:
          'Create, edit, test, and delete your own webhook endpoints.',
      },
      {
        key: 'appearance.personal',
        label: 'Personal appearance',
        description: 'Customize your own dashboard appearance.',
      },
    ],
  },
  {
    id: 'users',
    label: 'User management',
    description: 'Manage accounts below your highest role.',
    permissions: [
      {
        key: 'users.read',
        label: 'View users',
        description: 'Browse accounts and their usage.',
      },
      {
        key: 'users.create',
        label: 'Create users',
        description: 'Create accounts even when public registration is closed.',
      },
      {
        key: 'users.update',
        label: 'Edit users',
        description:
          'Change account identity, password, avatar, and URL identifiers.',
      },
      {
        key: 'users.delete',
        label: 'Delete users',
        description: 'Permanently delete accounts and their content.',
      },
      {
        key: 'users.sessions',
        label: 'Revoke sessions',
        description: 'Sign another account out of its browser sessions.',
      },
      {
        key: 'users.email',
        label: 'Manage email access',
        description:
          'Exempt accounts from email verification or resend verification.',
      },
      {
        key: 'users.roles',
        label: 'Assign roles',
        description:
          'Assign or remove lower roles with permissions you already hold.',
      },
    ],
  },
  {
    id: 'moderation',
    label: 'Content moderation',
    description: 'Instance-wide access to other accounts’ content.',
    permissions: [
      {
        key: 'content.read',
        label: 'View all content',
        description:
          'Inspect other users’ files and links, including private and password-protected files.',
      },
      {
        key: 'content.update',
        label: 'Edit all content',
        description:
          'Change other users’ file visibility and content settings.',
      },
      {
        key: 'content.delete',
        label: 'Delete all content',
        description:
          'Permanently delete other users’ files and shortened URLs.',
      },
    ],
  },
  {
    id: 'instance',
    label: 'Instance management',
    description: 'Configure and administer the instance.',
    permissions: [
      {
        key: 'roles.manage',
        label: 'Manage roles',
        description:
          'Create and edit lower roles with permissions you already hold.',
      },
      {
        key: 'settings.read',
        label: 'View settings',
        description: 'View instance configuration.',
      },
      {
        key: 'settings.general',
        label: 'General settings',
        description: 'Change instance details and general behavior.',
      },
      {
        key: 'settings.security',
        label: 'Security settings',
        description: 'Change registration, sign-in, and access policies.',
      },
      {
        key: 'settings.storage',
        label: 'Storage settings',
        description: 'Change storage, upload limits, and file processing.',
      },
      {
        key: 'settings.email',
        label: 'Email settings',
        description:
          'Configure outgoing mail, recovery, and email verification.',
      },
      {
        key: 'appearance.manage',
        label: 'Instance appearance',
        description: 'Change published branding and appearance policies.',
      },
      {
        key: 'quotas.bypass',
        label: 'Bypass storage quota',
        description:
          'Exempt your account from the storage quota. Maximum file size still applies.',
      },
      {
        key: 'administrator',
        label: 'Administrator',
        description:
          'Grant every permission, including future permissions, and bypass the role hierarchy. Assign only to trusted instance administrators.',
      },
    ],
  },
] as const

export type Permission =
  (typeof PERMISSION_GROUPS)[number]['permissions'][number]['key']
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions.map((permission) => permission.key)
)
export const DEFAULT_PERMISSIONS: readonly Permission[] =
  PERMISSION_GROUPS.filter((group) =>
    ['files', 'links', 'account'].includes(group.id)
  ).flatMap((group) => group.permissions.map((permission) => permission.key))

export interface RoleSummary {
  id: string
  name: string
  description: string
  color: string
  position: number
  systemKey: string | null
  permissions: string[]
}
export interface PermissionSubject {
  permissions?: readonly string[]
}

export function hasPermission(
  subject: PermissionSubject | null | undefined,
  permission: Permission
): boolean {
  return Boolean(
    subject?.permissions?.includes('administrator') ||
    subject?.permissions?.includes(permission)
  )
}

/** Unknown stored permission keys fail closed; administrator includes future catalog additions. */
export function resolvePermissions(
  roles: readonly Pick<RoleSummary, 'permissions'>[]
): Permission[] {
  const granted = new Set(roles.flatMap((role) => role.permissions))
  return ALL_PERMISSIONS.filter(
    (permission) => granted.has('administrator') || granted.has(permission)
  )
}

export function highestRolePosition(subject: {
  roles: readonly Pick<RoleSummary, 'position'>[]
}): number {
  return Math.max(0, ...subject.roles.map((role) => role.position))
}
