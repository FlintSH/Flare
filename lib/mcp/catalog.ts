/**
 * Every MCP tool, with what a call needs: the scopes its credential must
 * hold and the role permissions its owner must hold, exactly as the REST
 * route or dashboard action it mirrors. Arguments that do more name what else
 * they need under `effects`. A tool that can also act on another account's
 * content names what that needs under `moderation`. The token form reads
 * this table too, so it imports no server module.
 */
import {
  API_SCOPE_CATALOG,
  type ApiScope,
  isAdminScope,
  requestPermissions,
  scopeUsable,
} from '@/lib/integrations/bearer-routes'
import { ACTION_PERMISSIONS, type Action } from '@/lib/permissions/actions'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'
import type { Permission } from '@/lib/permissions/catalog'
import { settingsFieldPermission } from '@/lib/permissions/settings'

/** What a call, or one of its effects, needs on top of being authenticated. */
export type ToolNeeds = {
  /** Scopes the credential holds, every one of them. */
  scopes: readonly ApiScope[]
  /** Role permissions the credential's owner holds, every one of them. */
  permissions: readonly Permission[]
  /**
   * Role permissions of which the owner holds at least one, on top of
   * `permissions`: a route that serves several roles, or a tool whose call
   * decides which one it needs (each such choice is then an effect).
   */
  anyPermission?: readonly Permission[]
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
  /**
   * A second way to authorize the same tool: with its `account` argument it
   * acts on that account's content as a moderator, and needs these instead
   * of the row's own needs and effects. The tool is listed when either way
   * is allowed; each call is checked against the way its arguments choose.
   */
  moderation?: ToolNeeds
  annotations: ToolAnnotations
}

const action = (name: Action): readonly Permission[] => ACTION_PERMISSIONS[name]
type AdminAction = keyof typeof ADMIN_PERMISSIONS

/** What an administration route asks of the session: any one of these. */
const anyOf = (name: AdminAction): readonly Permission[] =>
  ADMIN_PERMISSIONS[name]

/**
 * The one permission an administration route asks for, as a list a row can
 * require. A route that accepts several goes in `anyPermission` instead.
 */
function admin(name: AdminAction): readonly Permission[] {
  const permissions: readonly Permission[] = ADMIN_PERMISSIONS[name]
  if (permissions.length !== 1)
    throw new Error(`${name} accepts any of several permissions`)
  return permissions
}

/** The permission `settingsPatchAllowed` gives a settings field. */
function setting(path: string): Permission {
  const permission = settingsFieldPermission(path)
  if (!permission)
    throw new Error(`${path} is not a setting a patch can change`)
  return permission
}

/** Moderation needs: the scope that reaches other accounts and one `content.*` permission. */
const moderate = (permission: Permission): ToolNeeds => ({
  scopes: ['admin:content'],
  permissions: [permission],
})

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
/** Every administration write is marked destructive, whatever it changes. */
const administer: ToolAnnotations = { ...add, destructive: true }

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
    moderation: moderate('content.read'),
    annotations: read,
  },
  get_file: {
    title: 'File details',
    scopes: ['files:read'],
    permissions: action('viewFiles'),
    moderation: moderate('content.read'),
    annotations: read,
  },
  read_file: {
    title: 'Read a file',
    scopes: ['files:content'],
    permissions: action('viewFiles'),
    moderation: moderate('content.read'),
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
    moderation: moderate('content.read'),
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
    moderation: moderate('content.update'),
    annotations: { ...destroy, openWorld: true },
  },
  delete_files: {
    title: 'Delete files',
    scopes: ['files:delete'],
    permissions: action('deleteFiles'),
    moderation: moderate('content.delete'),
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
    moderation: moderate('content.delete'),
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
  // Invites and administration. The permissions are the ones each route
  // asks of the session (`ADMIN_PERMISSIONS`, or the route's own literal);
  // the services check them again under the role lock. Every `admin:*`
  // scope also needs administration through MCP to be on.
  list_invites: {
    title: 'List invites',
    scopes: ['invites:write'],
    permissions: [],
    anyPermission: anyOf('listInvites'),
    // Everyone's invites, not only the account's own.
    effects: { all: { scopes: [], permissions: ['invites.manage'] } },
    annotations: read,
  },
  create_invite: {
    title: 'Create an invite',
    scopes: ['invites:write'],
    permissions: admin('createInvite'),
    // An invite that grants roles is user administration.
    effects: {
      roles: { scopes: ['admin:users'], permissions: admin('assignUserRoles') },
    },
    annotations: add,
  },
  revoke_invite: {
    title: 'Revoke an invite',
    scopes: ['invites:write'],
    permissions: [],
    // The account's own invite with `invites.create`; anyone's with
    // `invites.manage`, which the service decides.
    anyPermission: anyOf('revokeInvite'),
    annotations: destroy,
  },
  list_users: {
    title: 'List users',
    scopes: ['admin:read'],
    permissions: admin('listUsers'),
    effects: {
      email_status: { scopes: [], permissions: admin('manageUserEmail') },
    },
    annotations: read,
  },
  get_user: {
    title: 'User details',
    scopes: ['admin:read'],
    permissions: admin('getUser'),
    effects: {
      email_status: { scopes: [], permissions: admin('manageUserEmail') },
    },
    annotations: read,
  },
  list_roles: {
    title: 'List roles',
    scopes: ['admin:read'],
    permissions: [],
    anyPermission: anyOf('listRoles'),
    annotations: read,
  },
  get_instance_settings: {
    title: 'Instance settings',
    scopes: ['admin:read'],
    permissions: admin('readSettings'),
    effects: {
      email: { scopes: [], permissions: admin('manageEmailSettings') },
    },
    annotations: read,
  },
  search_audit_log: {
    title: 'Search the audit log',
    scopes: ['admin:read'],
    permissions: admin('readAuditLog'),
    annotations: read,
  },
  create_user: {
    title: 'Create a user',
    scopes: ['admin:users'],
    permissions: admin('createUser'),
    effects: { roles: { scopes: [], permissions: admin('assignUserRoles') } },
    annotations: administer,
  },
  // What a call needs depends on what it asks for, as with the routes: each
  // part is an effect, and a call that asks for several needs all of them.
  update_user: {
    title: 'Change a user',
    scopes: ['admin:users'],
    permissions: [],
    anyPermission: [
      ...admin('updateUser'),
      ...admin('assignUserRoles'),
      ...admin('manageUserEmail'),
      'users.sessions',
    ],
    effects: {
      // Name, public IDs, and removing the avatar (whose route needs the same).
      profile: { scopes: [], permissions: admin('updateUser') },
      roles: { scopes: [], permissions: admin('assignUserRoles') },
      email_verification: { scopes: [], permissions: admin('manageUserEmail') },
      sign_out: { scopes: [], permissions: ['users.sessions'] },
    },
    annotations: administer,
  },
  delete_user: {
    title: 'Delete a user',
    scopes: ['admin:users'],
    permissions: ['users.delete'],
    annotations: destroy,
  },
  save_role: {
    title: 'Create or change a role',
    scopes: ['admin:users'],
    permissions: admin('manageRoles'),
    annotations: administer,
  },
  delete_role: {
    title: 'Delete a role',
    scopes: ['admin:users'],
    permissions: admin('manageRoles'),
    annotations: destroy,
  },
  // Only these fields, each needing what a settings patch gives it. Nothing
  // under `general.mcp`, `general.oidc`, `general.setup`, `advanced`,
  // `appearance.favicon`, `email` or `customization` is ever accepted here.
  update_instance_settings: {
    title: 'Change instance settings',
    scopes: ['admin:settings'],
    permissions: [],
    anyPermission: [
      setting('general.registrations'),
      setting('general.storage'),
      setting('general.credits'),
      setting('appearance.theme'),
    ],
    effects: {
      registrations: {
        scopes: [],
        permissions: [setting('general.registrations')],
      },
      storage: { scopes: [], permissions: [setting('general.storage')] },
      credits: { scopes: [], permissions: [setting('general.credits')] },
      ocr: { scopes: [], permissions: [setting('general.ocr')] },
      // The classic theme and its colors.
      theme: { scopes: [], permissions: [setting('appearance.theme')] },
      // Its route, and the account's own permission to invite.
      everyone_can_invite: {
        scopes: [],
        permissions: [...admin('setEveryoneCanInvite'), 'invites.create'],
      },
    },
    annotations: { ...administer, idempotent: true },
  },
  update_email_settings: {
    title: 'Change email settings',
    scopes: ['admin:settings'],
    permissions: ['settings.email'],
    annotations: { ...administer, idempotent: true },
  },
  // It sends real mail with the saved connection.
  send_test_email: {
    title: 'Send a test email',
    scopes: ['admin:settings'],
    permissions: admin('manageEmailSettings'),
    annotations: { ...add, openWorld: true },
  },
  update_instance_appearance: {
    title: 'Change the instance appearance',
    scopes: ['admin:settings'],
    permissions: admin('manageAppearance'),
    annotations: administer,
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

/** What `needs` asks for that the subject lacks. */
export type MissingNeeds = {
  scopes: ApiScope[]
  permissions: Permission[]
  /** Present when the subject holds none of `needs.anyPermission`. */
  anyPermission?: readonly Permission[]
}

/** What `needs` asks for that the subject lacks; nothing listed means allowed. */
export function missingNeeds(
  needs: ToolNeeds,
  subject: ToolSubject
): MissingNeeds {
  const missing: MissingNeeds = {
    scopes: needs.scopes.filter((scope) => !subject.scopes.includes(scope)),
    permissions: needs.permissions.filter(
      (permission) => !subject.can(permission)
    ),
  }
  const any = needs.anyPermission
  if (any?.length && !any.some((permission) => subject.can(permission)))
    missing.anyPermission = any
  return missing
}

export function needsMet(needs: ToolNeeds, subject: ToolSubject): boolean {
  const missing = missingNeeds(needs, subject)
  return (
    !missing.scopes.length &&
    !missing.permissions.length &&
    !missing.anyPermission
  )
}

/**
 * Whether the subject may call the tool for its own account (owner mode);
 * effects are checked per call. Transfer URLs made in owner mode are
 * rechecked with this.
 */
export function toolAllowed(name: ToolName, subject: ToolSubject): boolean {
  return needsMet(TOOL_CATALOG[name], subject)
}

/** Whether the subject may call the tool on another account's content, as a moderator. */
export function moderationAllowed(
  name: ToolName,
  subject: ToolSubject
): boolean {
  const { moderation }: ToolRow = TOOL_CATALOG[name]
  return Boolean(moderation && needsMet(moderation, subject))
}

/**
 * Whether the tool is listed for the subject: it may call it in either
 * mode. Each call is still checked against the mode its arguments choose.
 */
export function toolListed(name: ToolName, subject: ToolSubject): boolean {
  return toolAllowed(name, subject) || moderationAllowed(name, subject)
}

/** The scopes MCP honors, in the order the token form lists them. */
export const MCP_SCOPES = API_SCOPE_CATALOG.filter(({ surfaces }) =>
  (surfaces as readonly string[]).includes('mcp')
).map(({ scope }) => scope)

/**
 * Whether a credential with this scope could do something for an owner who
 * `can` hold these permissions: call a REST route, or, where `mcp` says the
 * MCP server is on, an MCP tool. The `mcp` marker itself is usable whenever
 * the server is on. An `admin:*` scope is usable only while `administration`
 * says administration through MCP is on as well.
 */
export function scopeAvailable(
  scope: string,
  can: (permission: Permission) => boolean,
  mcp: boolean,
  administration = false
): boolean {
  if (scopeUsable(scope, can)) return true
  if (!mcp) return false
  if (scope === 'mcp') return true
  if (isAdminScope(scope) && !administration) return false
  const met = (needs: ToolNeeds) =>
    needs.permissions.every(can) &&
    (!needs.anyPermission?.length || needs.anyPermission.some(can))
  const grants = (needs: ToolNeeds) =>
    (needs.scopes as readonly string[]).includes(scope) && met(needs)
  return TOOL_NAMES.some((name) => {
    const row: ToolRow = TOOL_CATALOG[name]
    return (
      (met(row) &&
        (grants(row) || Object.values(row.effects ?? {}).some(grants))) ||
      Boolean(row.moderation && grants(row.moderation))
    )
  })
}
