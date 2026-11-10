// Import nothing here except types. The integrations panel bundles this module
// for the browser, and docs/site/scripts/check-coverage.mjs strips its types and
// imports it as a data: URL, where no other module can be resolved.
import type { Permission } from '@/lib/permissions/catalog'

/** Named-token scopes, in the order the token form lists them. */
export const API_SCOPE_CATALOG = [
  {
    scope: 'files:upload',
    label: 'Upload files',
    description: 'Send screenshots and files',
  },
  {
    scope: 'files:read',
    label: 'Read files',
    description: 'List your files and metadata',
  },
  {
    scope: 'urls:read',
    label: 'Read short links',
    description: 'List your shortened URLs',
  },
  {
    scope: 'urls:write',
    label: 'Manage short links',
    description: 'Create and delete your short links',
  },
] as const
export type ApiScope = (typeof API_SCOPE_CATALOG)[number]['scope']
export const API_SCOPES = API_SCOPE_CATALOG.map(({ scope }) => scope)

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
    methods: ['PUT', 'DELETE'],
    path: '/api/profile',
    permissions: ['profile.update'],
  },
  {
    methods: ['GET'],
    path: '/api/profile/export',
    permissions: ['profile.export', 'files.read', 'links.read'],
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

/** Whether a token with this scope could call at least one of its routes for an owner who `can` hold these permissions. */
export function scopeUsable(
  scope: string,
  can: (permission: Permission) => boolean
): boolean {
  return BEARER_ROUTES.some(
    (route) => route.scope === scope && route.permissions.every(can)
  )
}
