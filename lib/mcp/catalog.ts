/**
 * Every MCP tool, with what a call needs: the scopes its credential must
 * hold and the role permissions its owner must hold, exactly as the REST
 * route or dashboard action it mirrors. Arguments that do more name what else
 * they need under `effects`. The token form reads this table too, so it
 * imports no server module.
 */
import {
  API_SCOPE_CATALOG,
  type ApiScope,
  requestPermissions,
  scopeUsable,
} from '@/lib/integrations/bearer-routes'
import { ACTION_PERMISSIONS, type Action } from '@/lib/permissions/actions'
import type { Permission } from '@/lib/permissions/catalog'

/** What a call, or one of its effects, needs on top of being authenticated. */
export type ToolNeeds = {
  /** Scopes the credential holds, every one of them. */
  scopes: readonly ApiScope[]
  /** Role permissions the credential's owner holds, every one of them. */
  permissions: readonly Permission[]
}

export type ToolAnnotations = {
  /** The call changes nothing. */
  readOnly: boolean
  /**
   * The call can lose data, expose it, or cut off access in a way the same
   * connection cannot simply put back. Reversible organizing is not marked.
   */
  destructive: boolean
  /** Calling again with the same arguments changes nothing more. */
  idempotent: boolean
  /** The call reaches beyond Flare: it publishes, or follows an outside URL. */
  openWorld: boolean
}

export type ToolRow = ToolNeeds & {
  /** A short name for people; clients show it in place of the tool name. */
  title: string
  /** What an argument needs when it makes the call do more. */
  effects?: Record<string, ToolNeeds>
  annotations: ToolAnnotations
}

const action = (name: Action): readonly Permission[] => ACTION_PERMISSIONS[name]

/** The role permissions of the REST route a tool mirrors. */
function route(method: string, path: string): readonly Permission[] {
  const permissions = requestPermissions(method, path)
  if (!permissions) throw new Error(`${method} ${path} is not an account route`)
  return permissions
}

const read: ToolAnnotations = {
  readOnly: true,
  destructive: false,
  idempotent: true,
  openWorld: false,
}
const add: ToolAnnotations = {
  readOnly: false,
  destructive: false,
  idempotent: false,
  openWorld: false,
}
const arrange: ToolAnnotations = { ...add, idempotent: true }
const destroy: ToolAnnotations = {
  readOnly: false,
  destructive: true,
  idempotent: true,
  openWorld: false,
}

export const TOOL_CATALOG = {
  get_account: {
    title: 'Account and limits',
    scopes: [],
    permissions: [],
    effects: {
      upload_limits: {
        scopes: ['files:upload'],
        permissions: action('uploadFiles'),
      },
      // The profile list route needs the permission that manages profiles;
      // naming one is only of use to an account that may upload.
      upload_profiles: {
        scopes: ['files:upload'],
        permissions: [...action('uploadFiles'), 'uploadProfiles.manage'],
      },
      // A connection that may change profiles sees every one with its
      // settings, whether or not it may upload.
      manage_upload_profiles: {
        scopes: ['account:write'],
        permissions: ['uploadProfiles.manage'],
      },
      // What `update_profile` can change, so an agent can read before it
      // writes.
      profile_settings: {
        scopes: ['account:write'],
        permissions: route('PUT', '/api/profile'),
      },
    },
    annotations: read,
  },
  search_files: {
    title: 'Search files',
    scopes: ['files:read'],
    permissions: action('viewFiles'),
    annotations: read,
  },
  get_file: {
    title: 'File details',
    scopes: ['files:read'],
    permissions: action('viewFiles'),
    annotations: read,
  },
  read_file: {
    title: 'Read a file',
    scopes: ['files:content'],
    permissions: action('viewFiles'),
    annotations: read,
  },
  list_folders: {
    title: 'List folders',
    scopes: ['files:read'],
    permissions: route('GET', '/api/folders'),
    annotations: read,
  },
  list_tags: {
    title: 'List tags',
    scopes: ['files:read'],
    permissions: route('GET', '/api/tags'),
    annotations: read,
  },
  list_short_links: {
    title: 'List short links',
    scopes: ['urls:read'],
    permissions: action('viewLinks'),
    annotations: read,
  },
  upload_file: {
    title: 'Upload a file',
    scopes: ['files:upload'],
    permissions: action('uploadFiles'),
    annotations: add,
  },
  create_paste: {
    title: 'Create a paste',
    scopes: ['files:upload'],
    permissions: action('createPaste'),
    annotations: add,
  },
  create_upload_url: {
    title: 'Get an upload URL',
    scopes: ['files:upload'],
    permissions: action('uploadFiles'),
    annotations: add,
  },
  move_files: {
    title: 'Move files',
    scopes: ['files:organize'],
    permissions: action('moveFiles'),
    annotations: arrange,
  },
  tag_files: {
    title: 'Tag files',
    scopes: ['files:organize'],
    permissions: action('tagFiles'),
    annotations: arrange,
  },
  set_file_expiry: {
    title: 'Set file expiry',
    scopes: ['files:organize'],
    permissions: action('manageExpiration'),
    // Scheduling an expiry also needs what it does when it runs.
    effects: {
      delete: { scopes: ['files:delete'], permissions: action('deleteFiles') },
      make_private: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
    },
    annotations: destroy,
  },
  set_file_sharing: {
    title: 'Change file sharing',
    scopes: ['files:share'],
    permissions: action('shareFiles'),
    annotations: { ...destroy, openWorld: true },
  },
  delete_files: {
    title: 'Delete files',
    scopes: ['files:delete'],
    permissions: action('deleteFiles'),
    annotations: destroy,
  },
  save_folder: {
    title: 'Create or rename a folder',
    scopes: ['files:organize'],
    permissions: action('manageFolders'),
    annotations: add,
  },
  delete_folder: {
    title: 'Delete a folder',
    scopes: ['files:organize'],
    permissions: route('DELETE', '/api/folders/example'),
    annotations: destroy,
  },
  set_folder_sharing: {
    title: 'Change folder sharing',
    scopes: ['files:share'],
    permissions: action('shareFolders'),
    annotations: { ...destroy, openWorld: true },
  },
  save_tag: {
    title: 'Create or change a tag',
    scopes: ['files:organize'],
    permissions: route('POST', '/api/tags'),
    effects: {
      apply_rule_to_existing_files: {
        scopes: [],
        permissions: action('applyTagRule'),
      },
    },
    annotations: add,
  },
  delete_tag: {
    title: 'Delete a tag',
    scopes: ['files:organize'],
    permissions: route('DELETE', '/api/tags/example'),
    annotations: destroy,
  },
  create_short_link: {
    title: 'Shorten a URL',
    scopes: ['urls:write'],
    permissions: route('POST', '/api/urls'),
    annotations: { ...add, openWorld: true },
  },
  delete_short_link: {
    title: 'Delete a short link',
    scopes: ['urls:write'],
    permissions: route('DELETE', '/api/urls/example'),
    annotations: destroy,
  },
  // Extracting reads an archive's contents and uploads what is inside it.
  extract_archive: {
    title: 'Extract an archive',
    scopes: ['files:content', 'files:upload'],
    permissions: action('extractArchive'),
    annotations: add,
  },
  create_archive: {
    title: 'Create an archive',
    scopes: ['files:content', 'files:upload'],
    permissions: action('createArchive'),
    annotations: add,
  },
  update_profile: {
    title: 'Change account settings',
    scopes: ['account:write'],
    permissions: route('PUT', '/api/profile'),
    effects: {
      theme_mode: { scopes: [], permissions: ['appearance.personal'] },
      embed: { scopes: [], permissions: ['files.share'] },
      // A default expiry acts on every later upload, so it needs what the
      // expiry does when it runs, as scheduling one on a file does.
      default_expiry_delete: {
        scopes: ['files:delete'],
        permissions: action('deleteFiles'),
      },
      default_expiry_make_private: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
      // An avatar is a copy of the image that anyone can load, so choosing
      // one reads the file, and a file that is not public is published.
      avatar_file: {
        scopes: ['files:content'],
        permissions: action('viewFiles'),
      },
      avatar_private_file: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
    },
    // A default expiry can delete later uploads, a new vanity id breaks links
    // under the old one, and an avatar is public.
    annotations: destroy,
  },
  save_upload_profile: {
    title: 'Create or change an upload profile',
    scopes: ['account:write'],
    permissions: ['uploadProfiles.manage'],
    // A profile's expiry and visibility act on every later upload that uses
    // it, so a change needs what it does to those uploads.
    effects: {
      expiry_delete: {
        scopes: ['files:delete'],
        permissions: action('deleteFiles'),
      },
      expiry_make_private: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
      visibility_public: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
    },
    annotations: { ...add, destructive: true },
  },
  delete_upload_profile: {
    title: 'Delete an upload profile',
    scopes: ['account:write'],
    permissions: ['uploadProfiles.manage'],
    // Deleting the default profile hands uploads back to the account's own
    // settings: an expiry the profile was holding off, or public uploads
    // where it kept them private.
    effects: {
      expiry_delete: {
        scopes: ['files:delete'],
        permissions: action('deleteFiles'),
      },
      expiry_make_private: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
      visibility_public: {
        scopes: ['files:share'],
        permissions: action('shareFiles'),
      },
    },
    annotations: destroy,
  },
  // The export holds every file and link, so it needs every read scope.
  export_account: {
    title: 'Export the account',
    scopes: ['files:read', 'files:content', 'urls:read'],
    permissions: action('exportAccount'),
    annotations: read,
  },
} as const satisfies Record<string, ToolRow>

export type ToolName = keyof typeof TOOL_CATALOG

/** The tool names, in the order `tools/list` answers them. */
export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as ToolName[]

/** What decides a call: the credential's scopes and what its owner's role allows. */
export type ToolSubject = {
  scopes: readonly string[]
  can: (permission: Permission) => boolean
}

/** What `needs` asks for that the subject lacks; both lists empty means allowed. */
export function missingNeeds(needs: ToolNeeds, subject: ToolSubject) {
  return {
    scopes: needs.scopes.filter((scope) => !subject.scopes.includes(scope)),
    permissions: needs.permissions.filter(
      (permission) => !subject.can(permission)
    ),
  }
}

export function needsMet(needs: ToolNeeds, subject: ToolSubject): boolean {
  const missing = missingNeeds(needs, subject)
  return !missing.scopes.length && !missing.permissions.length
}

/** Whether the subject may call the tool at all; effects are checked per call. */
export function toolAllowed(name: ToolName, subject: ToolSubject): boolean {
  return needsMet(TOOL_CATALOG[name], subject)
}

/** The scopes MCP honors, in the order the token form lists them. */
export const MCP_SCOPES = API_SCOPE_CATALOG.filter(({ surfaces }) =>
  (surfaces as readonly string[]).includes('mcp')
).map(({ scope }) => scope)

/**
 * Whether a credential with this scope could do something for an owner who
 * `can` hold these permissions: call a REST route, or, where `mcp` says the
 * MCP server is on, an MCP tool. The `mcp` marker itself is usable whenever
 * the server is on.
 */
export function scopeAvailable(
  scope: string,
  can: (permission: Permission) => boolean,
  mcp: boolean
): boolean {
  if (scopeUsable(scope, can)) return true
  if (!mcp) return false
  if (scope === 'mcp') return true
  return TOOL_NAMES.some((name) => {
    const row: ToolRow = TOOL_CATALOG[name]
    const grants = (needs: ToolNeeds) =>
      (needs.scopes as readonly string[]).includes(scope) &&
      needs.permissions.every(can)
    return (
      (grants(row) || Object.values(row.effects ?? {}).some(grants)) &&
      row.permissions.every(can)
    )
  })
}
