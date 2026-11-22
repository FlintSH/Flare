// Import nothing here except types. The integrations panel bundles this module
// for the browser, and docs/site/scripts/check-coverage.mjs strips its types and
// imports it as a data: URL, where no other module can be resolved.
import type { Permission } from '@/lib/permissions/catalog'

/**
 * Named-token scopes, in the order the token form lists them. `surfaces` says
 * where a scope is honored: the REST routes below, the MCP tools in
 * `lib/mcp/catalog.ts`, or both. `mcp` is a marker: a named token works on the
 * MCP endpoint only while it carries it, so a token made for a script never
 * drives an agent.
 */
export const API_SCOPE_CATALOG = [
  {
    scope: 'files:upload',
    label: 'Upload files',
    description: 'Send screenshots and files',
    group: 'files',
    surfaces: ['api', 'mcp'],
  },
  {
    scope: 'files:read',
    label: 'Read files',
    description: 'List your files and metadata',
    group: 'files',
    surfaces: ['api', 'mcp'],
  },
  {
    scope: 'files:content',
    label: 'Read file contents',
    description: 'Read text, view images and download, private files included',
    group: 'files',
    surfaces: ['mcp'],
  },
  {
    scope: 'files:organize',
    label: 'Organize files',
    description: 'Folders, tags, moving files and expiry',
    group: 'files',
    surfaces: ['mcp'],
  },
  {
    scope: 'files:share',
    label: 'Change sharing',
    description: 'Visibility, passwords and folder links',
    group: 'files',
    surfaces: ['mcp'],
  },
  {
    scope: 'files:delete',
    label: 'Delete files',
    description: 'Delete files permanently',
    group: 'files',
    surfaces: ['mcp'],
  },
  {
    scope: 'urls:read',
    label: 'Read short links',
    description: 'List your shortened URLs',
    group: 'links',
    surfaces: ['api', 'mcp'],
  },
  {
    scope: 'urls:write',
    label: 'Manage short links',
    description: 'Create, redirect and delete your short links',
    group: 'links',
    surfaces: ['api', 'mcp'],
  },
  {
    scope: 'account:write',
    label: 'Change account settings',
    description: 'Profile, avatar, theme, embed style and upload profiles',
    group: 'account',
    surfaces: ['mcp'],
  },
  {
    scope: 'invites:write',
    label: 'Manage invites',
    description: 'List, create and revoke invite links',
    group: 'account',
    surfaces: ['mcp'],
  },
  // What an agent may do to the instance itself. These exist only while
  // administration through MCP is on, and are never part of a preset.
  {
    scope: 'admin:read',
    label: 'View administration',
    description:
      'Users, roles, instance settings with secrets hidden, and the audit log',
    group: 'administration',
    surfaces: ['mcp'],
  },
  {
    scope: 'admin:users',
    label: 'Manage users and roles',
    description: 'Create, edit and delete users and roles, and sign users out',
    group: 'administration',
    surfaces: ['mcp'],
  },
  {
    scope: 'admin:content',
    label: 'Moderate content',
    description:
      "View, change the sharing of, and delete other accounts' files and links",
    group: 'administration',
    surfaces: ['mcp'],
  },
  {
    scope: 'admin:settings',
    label: 'Change instance settings',
    description: 'Registration, storage, quotas, email policy and appearance',
    group: 'administration',
    surfaces: ['mcp'],
  },
  {
    scope: 'mcp',
    label: 'Agent access',
    description: 'Use this token with the MCP server',
    group: 'agents',
    surfaces: ['mcp'],
  },
] as const
export type ApiScope = (typeof API_SCOPE_CATALOG)[number]['scope']
export const API_SCOPES = API_SCOPE_CATALOG.map(({ scope }) => scope)
/** The marker a named token needs before the MCP endpoint accepts it. */
export const MCP_SCOPE = 'mcp' satisfies ApiScope

/**
 * The scopes that act on the instance rather than on one account. No
 * credential holds or uses one while administration through MCP is off.
 */
export const ADMIN_SCOPES = [
  'admin:read',
  'admin:users',
  'admin:content',
  'admin:settings',
] as const satisfies readonly ApiScope[]

export function isAdminScope(scope: string): boolean {
  return (ADMIN_SCOPES as readonly string[]).includes(scope)
}

/** Whether any of `scopes` acts on the instance. */
export const holdsAdminScope = (scopes: readonly string[]): boolean =>
  scopes.some(isAdminScope)

/** Where a scope is honored. */
export type ScopeSurface =
  (typeof API_SCOPE_CATALOG)[number]['surfaces'][number]

/** Whether the REST API honors a scope on at least one route. */
export function scopeWorksOverApi(scope: string): boolean {
  return API_SCOPE_CATALOG.some(
    (entry) =>
      entry.scope === scope &&
      (entry.surfaces as readonly ScopeSurface[]).includes('api')
  )
}

type BearerRoute = {
  methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  /** The exact pathname, or a pattern for paths with IDs. */
  path: string | RegExp
  /** What the account needs, whichever credential the request carries. */
  permissions: readonly Permission[]
  /** Named tokens need this scope. Without one, only browser sessions and the legacy upload token are accepted. */
  scope?: ApiScope
}

/**
 * Every route a browser session, the legacy upload token or a named token can
 * call through `requireAccount`. Routes and methods not listed fail closed, so
 * new account and admin endpoints never inherit bearer access. Routes named
 * tokens can call match only IDs of letters, digits, `_` and `-`.
 */
const BEARER_ROUTES: readonly BearerRoute[] = [
  // Anyone may read the public projection; the full settings are session-only.
  { methods: ['GET'], path: '/api/settings', permissions: [] },
  {
    methods: ['GET'],
    path: '/api/files',
    permissions: ['files.read'],
    scope: 'files:read',
  },
  {
    methods: ['POST'],
    path: '/api/files',
    permissions: ['files.upload'],
    scope: 'files:upload',
  },
  {
    methods: ['GET', 'POST', 'PUT'],
    path: '/api/files/chunks',
    permissions: ['files.upload'],
    scope: 'files:upload',
  },
  {
    methods: ['GET', 'PUT'],
    path: /^\/api\/files\/chunks\/[a-zA-Z0-9_-]+\/part\/\d+$/,
    permissions: ['files.upload'],
    scope: 'files:upload',
  },
  {
    methods: ['POST'],
    path: /^\/api\/files\/chunks\/[a-zA-Z0-9_-]+\/complete$/,
    permissions: ['files.upload'],
    scope: 'files:upload',
  },
  {
    methods: ['DELETE'],
    path: /^\/api\/files\/chunks\/[a-zA-Z0-9_-]+$/,
    permissions: ['files.upload'],
    scope: 'files:upload',
  },
  {
    methods: ['GET'],
    path: '/api/files/types',
    permissions: ['files.read'],
    scope: 'files:read',
  },
  {
    methods: ['GET'],
    path: '/api/files/timeline',
    permissions: ['files.read'],
    scope: 'files:read',
  },
  { methods: ['GET'], path: '/api/files/tags', permissions: ['files.read'] },
  {
    methods: ['PATCH'],
    path: '/api/files/tags',
    permissions: ['files.update', 'tags.manage'],
  },
  {
    methods: ['POST'],
    path: '/api/files/folders',
    permissions: ['files.update', 'folders.manage'],
  },
  {
    methods: ['GET'],
    path: /^\/api\/files\/[^/]+\/expiry$/,
    permissions: ['files.read'],
  },
  {
    methods: ['POST', 'DELETE'],
    path: /^\/api\/files\/[^/]+\/expiry$/,
    permissions: ['files.update'],
  },
  { methods: ['GET'], path: '/api/folders', permissions: ['files.read'] },
  { methods: ['POST'], path: '/api/folders', permissions: ['folders.manage'] },
  {
    methods: ['PATCH', 'DELETE'],
    path: /^\/api\/folders\/[^/]+$/,
    permissions: ['folders.manage'],
  },
  { methods: ['GET'], path: '/api/tags', permissions: ['files.read'] },
  { methods: ['POST'], path: '/api/tags', permissions: ['tags.manage'] },
  {
    methods: ['PATCH', 'DELETE'],
    path: /^\/api\/tags\/[^/]+$/,
    permissions: ['tags.manage'],
  },
  {
    methods: ['POST'],
    path: /^\/api\/tags\/[^/]+\/apply$/,
    permissions: ['tags.manage', 'files.update'],
  },
  {
    methods: ['GET'],
    path: '/api/urls',
    permissions: ['links.read'],
    scope: 'urls:read',
  },
  {
    methods: ['POST'],
    path: '/api/urls',
    permissions: ['links.create'],
    scope: 'urls:write',
  },
  {
    methods: ['DELETE'],
    path: /^\/api\/urls\/[a-zA-Z0-9_-]+$/,
    permissions: ['links.delete'],
    scope: 'urls:write',
  },
  {
    // A new destination retires the old redirect, as a delete would, and
    // makes a new one, so it needs both.
    methods: ['PATCH'],
    path: /^\/api\/urls\/[a-zA-Z0-9_-]+$/,
    permissions: ['links.create', 'links.delete'],
    scope: 'urls:write',
  },
  {
    methods: ['PUT', 'DELETE'],
    path: '/api/profile',
    permissions: ['profile.update'],
  },
  {
    methods: ['GET'],
    path: '/api/profile/export',
    permissions: ['profile.export', 'files.read', 'links.read'],
  },
  {
    methods: ['GET', 'POST'],
    path: '/api/profile/upload-token',
    permissions: ['tokens.manage'],
  },
]

function bearerRoute(method: string, pathname: string) {
  return BEARER_ROUTES.find(
    ({ methods, path }) =>
      methods.some((candidate) => candidate === method) &&
      (typeof path === 'string' ? path === pathname : path.test(pathname))
  )
}

/** What the account behind a request needs, or null when no account credential may call it. */
export function requestPermissions(
  method: string,
  pathname: string
): readonly Permission[] | null {
  return bearerRoute(method, pathname)?.permissions ?? null
}

/** The scope a named token needs, or null when named tokens may not call the route. */
export function requiredApiScope(
  method: string,
  pathname: string
): ApiScope | null {
  return bearerRoute(method, pathname)?.scope ?? null
}

/**
 * Whether a token with this scope could call at least one of its REST routes
 * for an owner who `can` hold these permissions. `scopeAvailable` in
 * `lib/mcp/catalog.ts` also counts what the scope allows through MCP.
 */
export function scopeUsable(
  scope: string,
  can: (permission: Permission) => boolean
): boolean {
  return BEARER_ROUTES.some(
    (route) => route.scope === scope && route.permissions.every(can)
  )
}
