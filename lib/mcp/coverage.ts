/**
 * What MCP covers of the HTTP API: every route under `app/api` and every
 * method it answers, with the tools that do the same thing or the reason no
 * tool does. A test compares this table to the route files, so a new route
 * cannot ship without a line here, and the handbook prints it. It imports
 * only types, so the handbook's checker can load it on its own.
 */
import type { ToolName } from './catalog'

/** Why a route has no tool, one sentence for each kind. */
export const UNEXPOSED_REASONS = {
  later: 'A later change adds tools for it.',
  credentials: 'An agent must not create, read or change credentials.',
  'sign-in': 'How people sign in and prove who they are stays in the browser.',
  'full-control': 'Full control of the instance stays in the browser.',
  browser: "It serves Flare's own pages and visitors.",
  preflight:
    'It answers a CORS preflight for browser apps and carries no data.',
  mcp: 'It is the MCP server itself.',
} as const
export type UnexposedReason = keyof typeof UNEXPOSED_REASONS

/** The later changes that add tools, by what they cover. */
export const LATER_AREAS = {
  invites: 'Invites',
  administration: 'Administration',
} as const
export type LaterArea = keyof typeof LATER_AREAS

export type CoverageMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

export type Coverage = (
  | { tools: readonly ToolName[] }
  | { reason: Exclude<UnexposedReason, 'later'> }
  | { reason: 'later'; area: LaterArea }
) & {
  /** Where a tool does less than the route, or does it differently. */
  note?: string
}

const tools = (...names: ToolName[]): Coverage => ({ tools: names })
const noted = (note: string, ...names: ToolName[]): Coverage => ({
  tools: names,
  note,
})
const later = (area: LaterArea): Coverage => ({ reason: 'later', area })
const not = (reason: Exclude<UnexposedReason, 'later'>): Coverage => ({
  reason,
})

const signIn = not('sign-in')
const credentials = not('credentials')
const browser = not('browser')
const preflight = not('preflight')
const invites = later('invites')
const administration = later('administration')
const chunked = noted(
  'An upload URL takes the whole file in one request; MCP has no chunked upload.',
  'create_upload_url'
)

/**
 * Paths are written as the endpoint inventory writes them, with `{name}` for
 * each `[name]` folder.
 */
export const API_COVERAGE: Record<
  string,
  Partial<Record<CoverageMethod, Coverage>>
> = {
  // Files
  '/api/files': {
    GET: tools('search_files', 'get_file'),
    POST: tools('upload_file', 'create_paste', 'create_upload_url'),
    OPTIONS: preflight,
  },
  '/api/files/types': {
    GET: noted(
      'search_files filters by type; no tool lists the types an account has.',
      'search_files'
    ),
    OPTIONS: preflight,
  },
  '/api/files/timeline': {
    GET: noted(
      'search_files answers the total for a date range, not counts per period.',
      'search_files'
    ),
    OPTIONS: preflight,
  },
  '/api/files/chunks': {
    GET: chunked,
    POST: chunked,
    PUT: chunked,
    OPTIONS: preflight,
  },
  '/api/files/chunks/{uploadId}/part/{partNumber}': {
    GET: chunked,
    PUT: chunked,
    OPTIONS: preflight,
  },
  '/api/files/chunks/{uploadId}/complete': {
    POST: chunked,
    OPTIONS: preflight,
  },
  '/api/files/{id}': {
    PATCH: tools('set_file_sharing'),
    DELETE: tools('delete_files'),
  },
  '/api/files/{path}': { GET: tools('read_file'), OPTIONS: preflight },
  '/api/files/{id}/download': {
    GET: tools('read_file'),
    POST: tools('read_file'),
    OPTIONS: preflight,
  },
  '/api/files/{id}/thumbnail': { GET: tools('read_file'), OPTIONS: preflight },
  '/api/files/{id}/ocr': {
    GET: noted(
      'read_file returns the text Flare has already read from an image; it does not start a new read.',
      'read_file'
    ),
    OPTIONS: preflight,
  },
  '/api/files/{id}/expiry': {
    GET: tools('get_file', 'search_files'),
    POST: tools('set_file_expiry'),
    DELETE: tools('set_file_expiry'),
  },
  '/api/files/folders': { POST: tools('move_files') },
  '/api/files/tags': {
    GET: tools('get_file', 'search_files'),
    PATCH: tools('tag_files'),
  },

  // Folders and tags
  '/api/folders': { GET: tools('list_folders'), POST: tools('save_folder') },
  '/api/folders/{id}': {
    PATCH: tools('save_folder', 'set_folder_sharing'),
    DELETE: tools('delete_folder'),
  },
  '/api/tags': { GET: tools('list_tags'), POST: tools('save_tag') },
  '/api/tags/{id}': { PATCH: tools('save_tag'), DELETE: tools('delete_tag') },
  '/api/tags/{id}/apply': { POST: tools('save_tag') },

  // Short links
  '/api/urls': {
    GET: tools('list_short_links'),
    POST: tools('create_short_link'),
    OPTIONS: preflight,
  },
  '/api/urls/{id}': {
    DELETE: tools('delete_short_link'),
    OPTIONS: preflight,
  },

  // Archives
  '/api/files/archive': { POST: tools('create_archive') },
  '/api/files/{id}/archive': { GET: tools('read_file') },
  '/api/files/{id}/archive/entry': { GET: tools('read_file') },
  '/api/files/{id}/archive/extract': { POST: tools('extract_archive') },
  // Visitors unlock a shared archive with a password cookie.
  '/api/files/{id}/archive/share': { POST: browser },
  '/api/files/{id}/archive/share/entry': { GET: browser, POST: browser },

  // The account
  '/api/profile': {
    PUT: noted(
      'update_profile changes the name, the vanity ID and the upload defaults; the email address and the password change only in the browser.',
      'update_profile'
    ),
    // Deleting the account an agent acts as is how its owner would lose it.
    DELETE: signIn,
  },
  '/api/profile/avatar': {
    POST: noted(
      'update_profile makes an image that is already in the library the avatar; it takes no upload of its own.',
      'update_profile'
    ),
  },
  '/api/profile/embed': {
    GET: tools('get_account'),
    PATCH: tools('update_profile'),
  },
  '/api/profile/export': { GET: tools('export_account') },
  // The export page follows its own download through this stream.
  '/api/profile/export/progress': { GET: browser },
  '/api/customization/preferences': {
    GET: tools('get_account'),
    PATCH: tools('update_profile'),
  },
  '/api/upload-profiles': {
    GET: tools('get_account'),
    POST: noted(
      'save_upload_profile takes the settings as arguments; it does not import a recipe file.',
      'save_upload_profile'
    ),
  },
  '/api/upload-profiles/default': { PUT: tools('save_upload_profile') },
  '/api/upload-profiles/{id}': {
    PUT: tools('save_upload_profile'),
    DELETE: tools('delete_upload_profile'),
  },
  // A recipe is a file the profile page exports and imports. What it holds,
  // a profile's name and settings, is what get_account lists.
  '/api/upload-profiles/{id}/export': {
    GET: noted(
      "get_account lists each profile's settings; no tool makes the recipe file.",
      'get_account'
    ),
  },
  '/api/profile/sessions': { GET: signIn, DELETE: signIn },
  '/api/profile/sessions/{id}': { DELETE: signIn },
  '/api/profile/login-history': { GET: signIn },

  // Credentials
  '/api/integrations': { GET: credentials, POST: credentials },
  '/api/profile/upload-token': { GET: credentials, POST: credentials },
  // Each of these downloads carries the account's upload token.
  '/api/profile/sharex': { GET: credentials },
  '/api/profile/itake': { GET: credentials },
  '/api/profile/bash': { GET: credentials },
  '/api/profile/flameshot': { POST: credentials },
  '/api/profile/spectacle': { POST: credentials },

  // Signing in
  '/api/auth/{nextauth}': { GET: signIn, POST: signIn },
  '/api/auth/register': { POST: signIn },
  '/api/auth/registration-status': { GET: signIn },
  '/api/auth/passkeys/options': { POST: signIn },
  '/api/auth/email/status': { GET: signIn },
  '/api/auth/email/capabilities': { GET: signIn },
  '/api/auth/email/enroll': { POST: signIn },
  '/api/auth/email/change': { POST: signIn },
  '/api/auth/email/cancel-change': { POST: signIn },
  '/api/auth/email/resend': { POST: signIn },
  '/api/auth/email/verify': { POST: signIn },
  '/api/auth/email/request-reset': { POST: signIn },
  '/api/auth/email/reset': { POST: signIn },
  '/api/auth/security': { GET: signIn },
  '/api/auth/security/totp/setup': { POST: signIn },
  '/api/auth/security/totp/enable': { POST: signIn },
  '/api/auth/security/totp/disable': { POST: signIn },
  '/api/auth/security/recovery-codes': { POST: signIn },
  '/api/auth/security/passkeys/options': { POST: signIn },
  '/api/auth/security/passkeys/verify': { POST: signIn },
  '/api/auth/security/passkeys/require': { POST: signIn },
  '/api/auth/security/passkeys/recovery-codes': { POST: signIn },
  '/api/auth/security/passkeys/{id}': { PATCH: signIn, DELETE: signIn },
  '/api/setup': { POST: signIn },
  '/api/setup/check': { GET: signIn },

  // Invites
  '/api/invites': { GET: invites, POST: invites },
  '/api/invites/{id}': { DELETE: invites },

  // Administration
  '/api/users': {
    GET: administration,
    POST: administration,
    PUT: administration,
  },
  '/api/users/{id}': { DELETE: administration },
  '/api/users/{id}/login': { POST: administration },
  '/api/users/{id}/avatar': { DELETE: administration },
  '/api/users/{id}/sessions': { DELETE: administration },
  '/api/users/{id}/email': { GET: administration, POST: administration },
  '/api/users/{id}/files': { GET: administration },
  '/api/users/{id}/files/{fileId}': {
    PATCH: administration,
    DELETE: administration,
  },
  '/api/users/{id}/urls': { GET: administration },
  '/api/users/{id}/urls/{urlId}': { DELETE: administration },
  '/api/roles': { GET: administration, POST: administration },
  '/api/roles/{id}': { PATCH: administration, DELETE: administration },
  '/api/audit': { GET: administration },
  '/api/settings': {
    GET: administration,
    PATCH: administration,
    // The legacy write replaces every setting at once, sign-in and custom
    // code included.
    POST: not('full-control'),
  },
  '/api/settings/invites': { GET: administration, PUT: administration },
  '/api/settings/email': { GET: administration, PUT: administration },
  '/api/settings/email/impact': { GET: administration, POST: administration },
  '/api/settings/email/test': { POST: administration },
  '/api/settings/email/retry': { POST: administration },
  '/api/updates/check': { GET: administration },
  '/api/customization': { GET: administration, POST: administration },
  // Logo and favicon uploads stay in the browser.
  '/api/customization/assets': { POST: browser },
  '/api/settings/favicon': { POST: browser, DELETE: browser },

  // Flare's own pages and visitors
  '/api/health': { GET: browser },
  '/api/oembed': { GET: browser },
  '/api/favicon': { GET: browser },
  '/api/avatars/{filename}': { GET: browser },
  '/api/storage/type': { GET: browser },

  // The MCP server
  '/api/mcp': {
    POST: not('mcp'),
    // Stateless: both answer 405.
    GET: not('mcp'),
    DELETE: not('mcp'),
    OPTIONS: preflight,
  },
  // The transfer URLs read_file, create_upload_url and export_account hand out.
  '/api/mcp/transfer/{ticket}': { GET: not('mcp'), POST: not('mcp') },
  // How an agent signs in to the server through the browser (OAuth). A
  // client calls these to connect; none of them is something a tool does.
  '/api/oauth/register': { POST: not('mcp'), OPTIONS: preflight },
  '/api/oauth/authorize': { GET: not('mcp'), POST: not('mcp') },
  '/api/oauth/authorize/resume': { GET: not('mcp') },
  '/api/oauth/token': { POST: not('mcp'), OPTIONS: preflight },
  '/api/oauth/revoke': { POST: not('mcp'), OPTIONS: preflight },
}
