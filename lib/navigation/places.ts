/**
 * Every page and setting Find can take you to, by its own name and the words
 * people use for it. Each place says what it needs, using the same rules as
 * the page that holds it, so Find never offers a door that won't open.
 * Browser-safe.
 */
import { allows } from '@/lib/permissions/actions'
import {
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'

/** Instance switches that decide whether a feature exists at all. */
export interface InstanceFeatures {
  /** The MCP server, which agents connect to. */
  agents: boolean
}

export type PlaceGroup = 'Pages' | 'Your settings' | 'Instance settings'

export interface Place {
  id: string
  title: string
  /** Where it lives, read as a trail ("Profile › Uploads"). */
  where: string
  href: string
  group: PlaceGroup
  /** Other words that should find it. */
  keywords: readonly string[]
  /** A feature the instance has switched off: shown to administrators only, with where to turn it on. */
  off?: string
  /** A dialog Find opens in place instead of going to `href`. */
  opens?: 'tags'
}

type Subject = PermissionSubject | null | undefined

interface PlaceRule extends Omit<Place, 'off'> {
  allowed: (user: Subject) => boolean
  /** When given and false, the feature is switched off for the instance. */
  feature?: keyof InstanceFeatures
  /** Where an administrator turns a switched-off feature on, and who may. */
  turnOn?: { where: string; href: string; allowed: (user: Subject) => boolean }
}

const can =
  (...permissions: Parameters<typeof hasPermission>[1][]) =>
  (user: Subject) =>
    permissions.every((permission) => hasPermission(user, permission))
const always = () => true

const profile = (section: string, anchor?: string) =>
  `/dashboard/profile?section=${section}${anchor ? `#${anchor}` : ''}`
const settings = (section: string, anchor?: string) =>
  `/dashboard/settings?section=${section}${anchor ? `#${anchor}` : ''}`

const PLACES: readonly PlaceRule[] = [
  // Pages
  {
    id: 'files',
    title: 'Files',
    where: 'Your library',
    href: '/dashboard',
    group: 'Pages',
    keywords: ['library', 'home', 'uploads', 'folders', 'browse'],
    allowed: (user) => allows(user, 'viewFiles'),
  },
  {
    id: 'upload',
    title: 'Upload',
    where: 'Send files',
    href: '/dashboard/upload',
    group: 'Pages',
    keywords: ['send', 'add files', 'drop'],
    allowed: (user) => allows(user, 'uploadFiles'),
  },
  {
    id: 'paste',
    title: 'Paste',
    where: 'Share text or code',
    href: '/dashboard/paste',
    group: 'Pages',
    keywords: ['pastebin', 'snippet', 'code', 'text', 'gist'],
    allowed: (user) => allows(user, 'createPaste'),
  },
  {
    id: 'links',
    title: 'Links',
    where: 'Short links',
    href: '/dashboard/urls',
    group: 'Pages',
    keywords: ['shorten', 'short link', 'url', 'redirect', 'qr'],
    allowed: (user) => allows(user, 'viewLinks'),
  },
  {
    id: 'profile',
    title: 'Profile',
    where: 'Your account',
    href: profile('account'),
    group: 'Pages',
    keywords: ['account', 'me', 'preferences'],
    allowed: always,
  },
  {
    id: 'users',
    title: 'Users',
    where: 'Admin',
    href: '/dashboard/users',
    group: 'Pages',
    keywords: ['accounts', 'members', 'people'],
    allowed: can('users.read'),
  },
  {
    id: 'roles',
    title: 'Roles',
    where: 'Admin',
    href: '/dashboard/roles',
    group: 'Pages',
    keywords: ['permissions', 'groups', 'access'],
    allowed: can('roles.manage'),
  },
  {
    id: 'audit',
    title: 'Audit log',
    where: 'Admin',
    href: '/dashboard/audit',
    group: 'Pages',
    keywords: ['activity', 'history', 'logs', 'events'],
    allowed: can('audit.read'),
  },
  {
    id: 'settings',
    title: 'Settings',
    where: 'Admin',
    href: settings('general'),
    group: 'Pages',
    keywords: ['instance', 'configuration', 'admin'],
    allowed: can('settings.read'),
  },

  // Your settings
  {
    id: 'identity',
    title: 'Name, email and avatar',
    where: 'Profile › Account',
    href: profile('account', 'profile-identity'),
    group: 'Your settings',
    keywords: ['username', 'name', 'email', 'avatar', 'photo', 'picture'],
    allowed: can('profile.update'),
  },
  {
    id: 'sign-in-security',
    title: 'Two-factor and passkeys',
    where: 'Profile › Account',
    href: profile('account', 'sign-in-security'),
    group: 'Your settings',
    keywords: [
      '2fa',
      'mfa',
      'authenticator',
      'totp',
      'passkey',
      'recovery codes',
      'security',
    ],
    allowed: always,
  },
  {
    id: 'sessions',
    title: 'Active sessions',
    where: 'Profile › Account',
    href: profile('account', 'active-sessions'),
    group: 'Your settings',
    keywords: ['devices', 'sign out everywhere', 'revoke'],
    allowed: always,
  },
  {
    id: 'login-history',
    title: 'Login history',
    where: 'Profile › Account',
    href: profile('account', 'login-history'),
    group: 'Your settings',
    keywords: ['sign-ins', 'logins'],
    allowed: always,
  },
  {
    id: 'password',
    title: 'Change password',
    where: 'Profile › Account',
    href: profile('account', 'password'),
    group: 'Your settings',
    keywords: ['password', 'credentials'],
    allowed: can('profile.update'),
  },
  {
    id: 'theme',
    title: 'Theme',
    where: 'Profile › Account',
    href: profile('account', 'workspace-appearance'),
    group: 'Your settings',
    keywords: ['dark mode', 'light mode', 'appearance', 'colors'],
    allowed: can('appearance.personal'),
  },
  {
    id: 'screenshot-tools',
    title: 'Screenshot tools',
    where: 'Profile › Uploads',
    href: profile('uploads', 'upload-tools'),
    group: 'Your settings',
    keywords: [
      'sharex',
      'itake',
      'flameshot',
      'spectacle',
      'bash',
      'script',
      'uploader',
      'config',
      'upload token',
    ],
    allowed: (user) => allows(user, 'uploaderTools'),
  },
  {
    id: 'upload-profiles',
    title: 'Upload profiles',
    where: 'Profile › Uploads',
    href: profile('uploads', 'upload-profiles'),
    group: 'Your settings',
    keywords: ['presets', 'recipes', 'default profile'],
    allowed: can('uploadProfiles.manage'),
  },
  {
    id: 'upload-defaults',
    title: 'Upload defaults',
    where: 'Profile › Uploads',
    href: profile('uploads', 'upload-defaults'),
    group: 'Your settings',
    keywords: [
      'vanity url',
      'custom url',
      'randomize',
      'random names',
      'default expiry',
      'expiration',
    ],
    allowed: can('profile.update'),
  },
  {
    id: 'embeds',
    title: 'Embeds',
    where: 'Profile',
    href: profile('embeds'),
    group: 'Your settings',
    keywords: ['discord', 'preview', 'open graph', 'og', 'unfurl', 'card'],
    allowed: can('files.share'),
  },
  {
    id: 'agents',
    title: 'AI agents',
    where: 'Profile › Integrations',
    href: profile('integrations', 'agents'),
    group: 'Your settings',
    keywords: ['mcp', 'claude', 'chatgpt', 'assistant', 'ai', 'connect'],
    allowed: can('tokens.manage'),
    feature: 'agents',
    turnOn: {
      where: 'Settings › Access',
      href: settings('access', 'mcp-server'),
      allowed: can('settings.security'),
    },
  },
  {
    id: 'api-tokens',
    title: 'API tokens',
    where: 'Profile › Integrations',
    href: profile('integrations', 'api-tokens'),
    group: 'Your settings',
    keywords: ['token', 'api key', 'automation', 'scripts'],
    allowed: can('tokens.manage'),
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    where: 'Profile › Integrations',
    href: profile('integrations', 'webhooks'),
    group: 'Your settings',
    keywords: ['notifications', 'events', 'callbacks'],
    allowed: can('webhooks.manage'),
  },
  {
    id: 'my-invites',
    title: 'Invite someone',
    where: 'Profile › Invites',
    href: profile('invites'),
    group: 'Your settings',
    keywords: ['invite', 'invitation', 'join', 'friend'],
    // People who manage every invite use Users › Invites instead.
    allowed: (user) =>
      hasPermission(user, 'invites.create') &&
      !hasPermission(user, 'invites.manage'),
  },
  {
    id: 'storage-use',
    title: 'Storage used',
    where: 'Profile › Your data',
    href: profile('data', 'storage'),
    group: 'Your settings',
    keywords: ['quota', 'space', 'usage', 'disk'],
    allowed: always,
  },
  {
    id: 'export',
    title: 'Export your data',
    where: 'Profile › Your data',
    href: profile('data', 'export'),
    group: 'Your settings',
    keywords: ['download everything', 'backup', 'takeout', 'zip'],
    allowed: (user) => allows(user, 'exportAccount'),
  },
  {
    id: 'delete-account',
    title: 'Delete your account',
    where: 'Profile › Your data',
    href: profile('data', 'delete-account'),
    group: 'Your settings',
    keywords: ['remove account', 'close account'],
    allowed: can('profile.update'),
  },
  {
    id: 'manage-tags',
    title: 'Tags',
    where: 'Files › Tags',
    href: '/dashboard',
    opens: 'tags',
    group: 'Your settings',
    keywords: ['labels', 'auto tag', 'rules', 'tag rules'],
    allowed: (user) =>
      allows(user, 'viewFiles') && hasPermission(user, 'tags.manage'),
  },

  // Instance settings
  {
    id: 'invites',
    title: 'Invites',
    where: 'Users',
    href: '/dashboard/users?tab=invites',
    group: 'Instance settings',
    keywords: ['invite', 'invitation', 'join', 'invite links'],
    allowed: can('invites.manage'),
  },
  {
    id: 'ocr',
    title: 'Image search',
    where: 'Settings › General',
    href: settings('general', 'image-search'),
    group: 'Instance settings',
    keywords: ['ocr', 'text in images', 'extract text'],
    allowed: can('settings.read'),
  },
  {
    id: 'credits',
    title: 'Credits footer',
    where: 'Settings › General',
    href: settings('general', 'credits'),
    group: 'Instance settings',
    keywords: ['footer', 'github link'],
    allowed: can('settings.read'),
  },
  {
    id: 'version',
    title: 'Version and updates',
    where: 'Settings › General',
    href: settings('general', 'instance-information'),
    group: 'Instance settings',
    keywords: ['update', 'release', 'about', 'version'],
    allowed: can('settings.read'),
  },
  {
    id: 'registration',
    title: 'Registration',
    where: 'Settings › Access',
    href: settings('access', 'registration'),
    group: 'Instance settings',
    keywords: ['sign up', 'signups', 'open registration', 'new accounts'],
    allowed: can('settings.read'),
  },
  {
    id: 'invite-rules',
    title: 'Who can invite',
    where: 'Settings › Access',
    href: settings('access', 'invites'),
    group: 'Instance settings',
    keywords: ['invite limits', 'everyone can invite'],
    allowed: can('settings.read'),
  },
  {
    id: 'sso',
    title: 'Single sign-on',
    where: 'Settings › Access',
    href: settings('access', 'single-sign-on'),
    group: 'Instance settings',
    keywords: ['sso', 'oidc', 'oauth', 'openid', 'authentik', 'keycloak'],
    allowed: can('settings.read'),
  },
  {
    id: 'mcp',
    title: 'MCP server',
    where: 'Settings › Access',
    href: settings('access', 'mcp-server'),
    group: 'Instance settings',
    keywords: ['agents', 'ai', 'mcp', 'claude'],
    allowed: can('settings.read'),
  },
  {
    id: 'file-storage',
    title: 'File storage',
    where: 'Settings › Storage',
    href: settings('storage', 'file-storage'),
    group: 'Instance settings',
    keywords: ['s3', 'bucket', 'local', 'max upload size', 'limit'],
    allowed: can('settings.read'),
  },
  {
    id: 'quotas',
    title: 'Storage quotas',
    where: 'Settings › Storage',
    href: settings('storage', 'storage-quotas'),
    group: 'Instance settings',
    keywords: ['quota', 'limits', 'space'],
    allowed: can('settings.read'),
  },
  {
    id: 'appearance',
    title: 'Branding and themes',
    where: 'Settings › Appearance',
    href: settings('appearance'),
    group: 'Instance settings',
    keywords: [
      'brand',
      'logo',
      'theme',
      'colors',
      'name',
      'share page',
      'embeds',
      'studio',
    ],
    allowed: can('settings.read'),
  },
  {
    id: 'custom-css',
    title: 'Custom CSS and head HTML',
    where: 'Settings › Appearance',
    href: settings('appearance', 'advanced-styles'),
    group: 'Instance settings',
    keywords: ['css', 'html', 'styles', 'analytics'],
    allowed: can('settings.read'),
  },
  {
    id: 'email',
    title: 'Email',
    where: 'Settings › Email',
    href: settings('email'),
    group: 'Instance settings',
    keywords: ['smtp', 'mail', 'password reset', 'verification', 'recovery'],
    allowed: can('settings.read'),
  },
]

/**
 * The places this person can open. A place whose feature the instance has
 * switched off is left out, except for people who can switch it on: they get
 * it pointing at that switch.
 */
export function placesFor(user: Subject, features: InstanceFeatures): Place[] {
  return PLACES.flatMap(({ allowed, feature, turnOn, ...place }): Place[] => {
    if (!allowed(user)) return []
    if (!feature || features[feature]) return [place]
    if (!turnOn?.allowed(user)) return []
    return [{ ...place, href: turnOn.href, off: turnOn.where }]
  })
}

/** Lowercased words without accents, for matching typed text. */
export function normalizeQuery(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How well a place answers the query: 3 for its title starting with it, 2
 * for a word of the title or a keyword starting with it, 1 for containing
 * it, 0 for no match.
 */
function placeScore(place: Place, query: string) {
  const title = normalizeQuery(place.title)
  if (title.startsWith(query)) return 3
  const words = [
    ...title.split(' '),
    ...place.keywords.map(normalizeQuery),
    normalizeQuery(place.where),
  ]
  if (words.some((word) => word.startsWith(query))) return 2
  if (
    title.includes(query) ||
    place.keywords.some((keyword) => normalizeQuery(keyword).includes(query))
  )
    return 1
  return 0
}

/** The places that answer the query, best first, at most `limit`. */
export function matchPlaces(places: readonly Place[], text: string, limit = 6) {
  const query = normalizeQuery(text)
  if (!query) return []
  return places
    .map((place, index) => ({ place, index, score: placeScore(place, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ place }) => place)
}

/** For tests: every place and the anchor it lands on. */
export const ALL_PLACES: readonly Pick<Place, 'id' | 'href'>[] = PLACES
