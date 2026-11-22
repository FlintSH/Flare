import { ExpiryAction } from '@/types/events'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  API_SCOPE_CATALOG,
  type ApiScope,
  MCP_SCOPE,
  requestPermissions,
  requiredApiScope,
  scopeUsable,
  scopeWorksOverApi,
} from '@/lib/integrations/bearer-routes'
import {
  MCP_SCOPES,
  TOOL_CATALOG,
  TOOL_NAMES,
  type ToolName,
  type ToolNeeds,
  type ToolRow,
  type ToolSubject,
  missingNeeds,
  moderationAllowed,
  needsMet,
  scopeAvailable,
  toolAllowed,
  toolListed,
} from '@/lib/mcp/catalog'
import {
  ACTION_PERMISSIONS,
  type Action,
  EXPIRY_EFFECTS,
} from '@/lib/permissions/actions'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'
import {
  ALL_PERMISSIONS,
  type Permission,
  hasPermission,
} from '@/lib/permissions/catalog'
import { settingsPatchAllowed } from '@/lib/permissions/settings'
import { userUpdatePermission } from '@/lib/users/admin'

// The tool definitions import the services; this file only reads their names.
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))

const ALL_SCOPES: readonly string[] = API_SCOPE_CATALOG.map(
  ({ scope }) => scope
)
/** Every role permission except the one that grants all the others. */
const ORDINARY_PERMISSIONS = ALL_PERMISSIONS.filter(
  (permission) => permission !== 'administrator'
)

/** A credential's scopes with the role permissions of the account behind it. */
const subject = (
  scopes: readonly string[],
  permissions: readonly string[]
): ToolSubject => ({
  scopes,
  can: (permission) => hasPermission({ permissions }, permission),
})
const without = <T>(values: readonly T[], value: T) =>
  values.filter((candidate) => candidate !== value)
const sorted = (values: readonly string[]) => [...values].sort()

const rows: [ToolName, ToolRow][] = TOOL_NAMES.map((name) => [
  name,
  TOOL_CATALOG[name],
])
const effects = TOOL_NAMES.flatMap((name) =>
  Object.entries((TOOL_CATALOG[name] as ToolRow).effects ?? {}).map(
    ([effect, needs]) => [name, effect, needs] as const
  )
)

/** Exactly what `needs` asks for: its scopes, its permissions, and one of the alternatives. */
const enough = (needs: ToolNeeds) =>
  subject(needs.scopes, [
    ...needs.permissions,
    ...(needs.anyPermission?.slice(0, 1) ?? []),
  ])

/** The three ways the design asks every row and effect to be tested. */
function expectNeedsEnforced(needs: ToolNeeds) {
  // Exactly what is asked for, and nothing else, is enough.
  expect(needsMet(needs, enough(needs))).toBe(true)
  expect(missingNeeds(needs, enough(needs))).toEqual({
    scopes: [],
    permissions: [],
  })
  // Any one of the alternatives will do, and having none of them will not.
  const any = needs.anyPermission ?? []
  for (const permission of any)
    expect(
      needsMet(
        needs,
        subject(needs.scopes, [...needs.permissions, permission])
      ),
      `with only ${permission} of the alternatives`
    ).toBe(true)
  if (any.length) {
    const lacking = subject(
      ALL_SCOPES,
      ORDINARY_PERMISSIONS.filter((permission) => !any.includes(permission))
    )
    expect(needsMet(needs, lacking), 'without every alternative').toBe(false)
    expect(missingNeeds(needs, lacking)).toEqual({
      scopes: [],
      permissions: needs.permissions.filter((permission) =>
        any.includes(permission)
      ),
      anyPermission: any,
    })
  }
  // Every other scope and every other permission cannot stand in for one.
  for (const scope of needs.scopes) {
    const lacking = subject(without(ALL_SCOPES, scope), ORDINARY_PERMISSIONS)
    expect(needsMet(needs, lacking), `without scope ${scope}`).toBe(false)
    expect(missingNeeds(needs, lacking)).toEqual({
      scopes: [scope],
      permissions: [],
    })
  }
  for (const permission of needs.permissions) {
    // A custom role that holds everything but this one permission.
    const lacking = subject(
      ALL_SCOPES,
      without(ORDINARY_PERMISSIONS, permission)
    )
    expect(needsMet(needs, lacking), `without ${permission}`).toBe(false)
    expect(missingNeeds(needs, lacking)).toEqual({
      scopes: [],
      permissions: [permission],
    })
  }
  // An administrator's role satisfies every permission and no scope.
  expect(needsMet(needs, subject(needs.scopes, ['administrator']))).toBe(true)
  if (needs.scopes.length)
    expect(needsMet(needs, subject([], ['administrator']))).toBe(false)
}

describe('the tool list and the catalog', () => {
  let TOOLS: typeof import('@/lib/mcp/tools').TOOLS
  // Every tool module, loaded cold: slow on a busy machine, so it has its
  // own time and the tests below only read what it loaded.
  beforeAll(async () => {
    ;({ TOOLS } = await import('@/lib/mcp/tools'))
  }, 60_000)

  it('name exactly the same tools, each once', () => {
    const defined = TOOLS.map((tool) => tool.name)
    expect(new Set(defined).size, 'a tool is defined twice').toBe(
      defined.length
    )
    expect(sorted(defined)).toEqual(sorted(TOOL_NAMES))
  })

  it('has the 29 tools of an account, then invites and administration, in the order clients list them', () => {
    expect(TOOL_NAMES).toEqual([
      'get_account',
      'search_files',
      'get_file',
      'read_file',
      'list_folders',
      'list_tags',
      'list_short_links',
      'upload_file',
      'create_paste',
      'create_upload_url',
      'move_files',
      'tag_files',
      'set_file_expiry',
      'set_file_sharing',
      'delete_files',
      'save_folder',
      'delete_folder',
      'set_folder_sharing',
      'save_tag',
      'delete_tag',
      'create_short_link',
      'update_short_link',
      'delete_short_link',
      'extract_archive',
      'create_archive',
      'update_profile',
      'save_upload_profile',
      'delete_upload_profile',
      'export_account',
      'list_invites',
      'create_invite',
      'revoke_invite',
      'list_users',
      'get_user',
      'list_roles',
      'get_instance_settings',
      'search_audit_log',
      'create_user',
      'update_user',
      'delete_user',
      'save_role',
      'delete_role',
      'update_instance_settings',
      'update_email_settings',
      'send_test_email',
      'update_instance_appearance',
    ])
    expect(TOOL_NAMES).toHaveLength(46)
  })

  it('lets exactly the tools whose rows have moderation needs take an account', () => {
    expect(
      sorted(TOOLS.filter((tool) => tool.moderation).map((tool) => tool.name))
    ).toEqual(
      sorted(
        TOOL_NAMES.filter((name) => (TOOL_CATALOG[name] as ToolRow).moderation)
      )
    )
  })

  it.each(rows)('%s has a short title for people', (_name, row) => {
    expect(row.title.trim()).toBe(row.title)
    expect(row.title.length).toBeGreaterThan(3)
    expect(row.title.length).toBeLessThanOrEqual(40)
  })
})

describe('the access rule', () => {
  it.each(rows)(
    '%s is refused without each scope, refused without each role permission, allowed with all',
    (name, row) => {
      expectNeedsEnforced(row)
      expect(toolAllowed(name, enough(row))).toBe(true)
      expect(toolListed(name, enough(row))).toBe(true)
      // Without moderating, which is a way of its own.
      const owner = (scopes: readonly string[], permissions: string[]) =>
        subject(without(scopes, 'admin:content'), permissions)
      for (const scope of row.scopes) {
        const lacking = owner(without(ALL_SCOPES, scope), ORDINARY_PERMISSIONS)
        expect(toolAllowed(name, lacking)).toBe(false)
        expect(toolListed(name, lacking)).toBe(false)
      }
      for (const permission of row.permissions) {
        const lacking = owner(
          ALL_SCOPES,
          without(ORDINARY_PERMISSIONS, permission)
        )
        expect(toolAllowed(name, lacking)).toBe(false)
        expect(toolListed(name, lacking)).toBe(false)
      }
    }
  )

  const moderated = rows.filter(([, row]) => row.moderation)

  it('gives exactly the seven content tools a moderator mode', () => {
    expect(moderated.map(([name]) => name)).toEqual([
      'search_files',
      'get_file',
      'read_file',
      'list_short_links',
      'set_file_sharing',
      'delete_files',
      'delete_short_link',
    ])
  })

  it.each(moderated)(
    'lets %s moderate with its moderation needs alone, and not without them',
    (name, row) => {
      const moderation = row.moderation!
      expectNeedsEnforced(moderation)
      // A second way to the same tool, not an extra requirement.
      const moderator = enough(moderation)
      expect(moderationAllowed(name, moderator)).toBe(true)
      expect(toolAllowed(name, moderator)).toBe(false)
      expect(toolListed(name, moderator)).toBe(true)
      const owner = enough(row)
      expect(moderationAllowed(name, owner)).toBe(false)
      expect(toolListed(name, owner)).toBe(true)
      // The scope with every other content permission is not enough.
      const others = (
        ['content.read', 'content.update', 'content.delete'] as const
      ).filter((permission) => !moderation.permissions.includes(permission))
      expect(toolListed(name, subject(['admin:content'], others))).toBe(false)
      // And the permissions are no use without the scope.
      expect(
        toolListed(
          name,
          subject([], ['content.read', 'content.update', 'content.delete'])
        )
      ).toBe(false)
    }
  )

  it('has no moderator mode on any other tool', () => {
    for (const [name, row] of rows)
      if (!row.moderation)
        expect(
          moderationAllowed(name, subject(ALL_SCOPES, ['administrator'])),
          name
        ).toBe(false)
  })

  it.each(effects)(
    'the %s effect %s is refused without each scope, refused without each role permission, allowed with all',
    (_name, _effect, needs) => expectNeedsEnforced(needs)
  )

  it('allows a tool whatever its effects need: they are checked per call', () => {
    const expiry = TOOL_CATALOG.set_file_expiry
    const organizer = subject(expiry.scopes, expiry.permissions)
    expect(toolAllowed('set_file_expiry', organizer)).toBe(true)
    expect(needsMet(expiry.effects.delete, organizer)).toBe(false)
    expect(needsMet(expiry.effects.make_private, organizer)).toBe(false)
  })

  it('reads scopes and permissions separately: a scope is no permission and a permission no scope', () => {
    const row = TOOL_CATALOG.delete_files
    expect(toolAllowed('delete_files', subject(['files.delete'], []))).toBe(
      false
    )
    expect(
      toolAllowed('delete_files', subject(row.scopes, ['files:delete']))
    ).toBe(false)
  })

  it('needs only authentication for get_account', () => {
    expect(toolAllowed('get_account', subject([], []))).toBe(true)
  })
})

type Needs = {
  scopes: ApiScope[]
  permissions: Permission[]
  anyPermission?: Permission[]
}

/**
 * Design 3.6, written out by hand: the scope and the role permissions each
 * tool and effect needs. A row that drifts from the approved table fails here.
 * One refinement since: upload limits and upload profiles are shown only to
 * an account that may upload, so both also need `files.upload`. A scope that
 * works over REST is then offered for MCP to exactly the same roles. The
 * design's "or `account:write`" for the profile list is its own effect.
 */
const DESIGN: Record<
  ToolName,
  Needs & { effects?: Record<string, Needs>; moderation?: Needs }
> = {
  get_account: {
    scopes: [],
    permissions: [],
    effects: {
      upload_limits: {
        scopes: ['files:upload'],
        permissions: ['files.upload'],
      },
      upload_profiles: {
        scopes: ['files:upload'],
        permissions: ['files.upload', 'uploadProfiles.manage'],
      },
      manage_upload_profiles: {
        scopes: ['account:write'],
        permissions: ['uploadProfiles.manage'],
      },
      profile_settings: {
        scopes: ['account:write'],
        permissions: ['profile.update'],
      },
    },
  },
  // The `account` argument of design 3.6: a second way to the same tool.
  search_files: {
    scopes: ['files:read'],
    permissions: ['files.read'],
    moderation: { scopes: ['admin:content'], permissions: ['content.read'] },
  },
  get_file: {
    scopes: ['files:read'],
    permissions: ['files.read'],
    moderation: { scopes: ['admin:content'], permissions: ['content.read'] },
  },
  read_file: {
    scopes: ['files:content'],
    permissions: ['files.read'],
    moderation: { scopes: ['admin:content'], permissions: ['content.read'] },
  },
  list_folders: { scopes: ['files:read'], permissions: ['files.read'] },
  list_tags: { scopes: ['files:read'], permissions: ['files.read'] },
  list_short_links: {
    scopes: ['urls:read'],
    permissions: ['links.read'],
    moderation: { scopes: ['admin:content'], permissions: ['content.read'] },
  },
  upload_file: { scopes: ['files:upload'], permissions: ['files.upload'] },
  create_paste: {
    scopes: ['files:upload'],
    permissions: ['files.upload', 'pastes.create'],
  },
  create_upload_url: {
    scopes: ['files:upload'],
    permissions: ['files.upload'],
  },
  move_files: {
    scopes: ['files:organize'],
    permissions: ['files.update', 'folders.manage'],
  },
  tag_files: {
    scopes: ['files:organize'],
    permissions: ['files.update', 'tags.manage'],
  },
  set_file_expiry: {
    scopes: ['files:organize'],
    permissions: ['files.update'],
    effects: {
      delete: { scopes: ['files:delete'], permissions: ['files.delete'] },
      make_private: { scopes: ['files:share'], permissions: ['files.share'] },
    },
  },
  set_file_sharing: {
    scopes: ['files:share'],
    permissions: ['files.share'],
    moderation: { scopes: ['admin:content'], permissions: ['content.update'] },
  },
  delete_files: {
    scopes: ['files:delete'],
    permissions: ['files.delete'],
    moderation: { scopes: ['admin:content'], permissions: ['content.delete'] },
  },
  save_folder: {
    scopes: ['files:organize'],
    permissions: ['folders.manage'],
  },
  delete_folder: {
    scopes: ['files:organize'],
    permissions: ['folders.manage'],
  },
  set_folder_sharing: {
    scopes: ['files:share'],
    permissions: ['folders.manage', 'folders.share'],
  },
  save_tag: {
    scopes: ['files:organize'],
    permissions: ['tags.manage'],
    effects: {
      apply_rule_to_existing_files: {
        scopes: [],
        permissions: ['tags.manage', 'files.update'],
      },
    },
  },
  delete_tag: { scopes: ['files:organize'], permissions: ['tags.manage'] },
  create_short_link: { scopes: ['urls:write'], permissions: ['links.create'] },
  // A new target retires the old redirect, as a delete would.
  update_short_link: {
    scopes: ['urls:write'],
    permissions: ['links.create', 'links.delete'],
  },
  delete_short_link: {
    scopes: ['urls:write'],
    permissions: ['links.delete'],
    moderation: { scopes: ['admin:content'], permissions: ['content.delete'] },
  },
  extract_archive: {
    scopes: ['files:content', 'files:upload'],
    permissions: ['files.read', 'files.upload', 'folders.manage'],
  },
  create_archive: {
    scopes: ['files:content', 'files:upload'],
    permissions: ['files.read', 'files.upload'],
  },
  update_profile: {
    scopes: ['account:write'],
    permissions: ['profile.update'],
    effects: {
      theme_mode: { scopes: [], permissions: ['appearance.personal'] },
      embed: { scopes: [], permissions: ['files.share'] },
      default_expiry_delete: {
        scopes: ['files:delete'],
        permissions: ['files.delete'],
      },
      default_expiry_make_private: {
        scopes: ['files:share'],
        permissions: ['files.share'],
      },
      avatar_file: { scopes: ['files:content'], permissions: ['files.read'] },
      avatar_private_file: {
        scopes: ['files:share'],
        permissions: ['files.share'],
      },
    },
  },
  save_upload_profile: {
    scopes: ['account:write'],
    permissions: ['uploadProfiles.manage'],
    effects: {
      expiry_delete: {
        scopes: ['files:delete'],
        permissions: ['files.delete'],
      },
      expiry_make_private: {
        scopes: ['files:share'],
        permissions: ['files.share'],
      },
      visibility_public: {
        scopes: ['files:share'],
        permissions: ['files.share'],
      },
    },
  },
  delete_upload_profile: {
    scopes: ['account:write'],
    permissions: ['uploadProfiles.manage'],
    effects: {
      expiry_delete: {
        scopes: ['files:delete'],
        permissions: ['files.delete'],
      },
      expiry_make_private: {
        scopes: ['files:share'],
        permissions: ['files.share'],
      },
      visibility_public: {
        scopes: ['files:share'],
        permissions: ['files.share'],
      },
    },
  },
  export_account: {
    scopes: ['files:read', 'files:content', 'urls:read'],
    permissions: ['profile.export', 'files.read', 'links.read'],
  },
  // Design 3.6 and the PR 4 brief, from list_invites down.
  list_invites: {
    scopes: ['invites:write'],
    permissions: [],
    anyPermission: ['invites.create', 'invites.manage'],
    effects: { all: { scopes: [], permissions: ['invites.manage'] } },
  },
  create_invite: {
    scopes: ['invites:write'],
    permissions: ['invites.create'],
    effects: {
      roles: { scopes: ['admin:users'], permissions: ['users.roles'] },
    },
  },
  revoke_invite: {
    scopes: ['invites:write'],
    permissions: [],
    anyPermission: ['invites.create', 'invites.manage'],
  },
  list_users: {
    scopes: ['admin:read'],
    permissions: ['users.read'],
    effects: { email_status: { scopes: [], permissions: ['users.email'] } },
  },
  get_user: {
    scopes: ['admin:read'],
    permissions: ['users.read'],
    effects: { email_status: { scopes: [], permissions: ['users.email'] } },
  },
  list_roles: {
    scopes: ['admin:read'],
    permissions: [],
    anyPermission: ['roles.manage', 'users.roles', 'users.read'],
  },
  get_instance_settings: {
    scopes: ['admin:read'],
    permissions: ['settings.read'],
    effects: { email: { scopes: [], permissions: ['settings.email'] } },
  },
  search_audit_log: { scopes: ['admin:read'], permissions: ['audit.read'] },
  create_user: {
    scopes: ['admin:users'],
    permissions: ['users.create'],
    effects: { roles: { scopes: [], permissions: ['users.roles'] } },
  },
  update_user: {
    scopes: ['admin:users'],
    permissions: [],
    anyPermission: [
      'users.update',
      'users.roles',
      'users.email',
      'users.sessions',
    ],
    effects: {
      profile: { scopes: [], permissions: ['users.update'] },
      roles: { scopes: [], permissions: ['users.roles'] },
      email_verification: { scopes: [], permissions: ['users.email'] },
      sign_out: { scopes: [], permissions: ['users.sessions'] },
    },
  },
  delete_user: { scopes: ['admin:users'], permissions: ['users.delete'] },
  save_role: { scopes: ['admin:users'], permissions: ['roles.manage'] },
  delete_role: { scopes: ['admin:users'], permissions: ['roles.manage'] },
  update_instance_settings: {
    scopes: ['admin:settings'],
    permissions: [],
    anyPermission: [
      'settings.security',
      'settings.storage',
      'settings.general',
      'appearance.manage',
    ],
    effects: {
      registrations: { scopes: [], permissions: ['settings.security'] },
      storage: { scopes: [], permissions: ['settings.storage'] },
      credits: { scopes: [], permissions: ['settings.general'] },
      ocr: { scopes: [], permissions: ['settings.general'] },
      theme: { scopes: [], permissions: ['appearance.manage'] },
      everyone_can_invite: {
        scopes: [],
        permissions: ['settings.security', 'invites.create'],
      },
    },
  },
  update_email_settings: {
    scopes: ['admin:settings'],
    permissions: ['settings.email'],
  },
  send_test_email: {
    scopes: ['admin:settings'],
    permissions: ['settings.email'],
  },
  update_instance_appearance: {
    scopes: ['admin:settings'],
    permissions: ['appearance.manage'],
  },
}

type Mirror = {
  /** Dashboard actions whose permissions the tool must need. */
  actions?: Action[]
  /** Account routes whose permissions the tool must need. */
  routes?: [method: string, path: string][]
  /**
   * Routes only a browser session may call, which the bearer route table
   * does not hold: the tool must need the permission each one's handler
   * passes to `requireSession`, read from the route file. A handler that
   * passes a list of alternatives is mirrored by `anyPermission`.
   */
  session?: [method: string, file: string][]
  /**
   * What the user edit route asks of these fields (`userUpdatePermission`,
   * which `PUT /api/users` checks before anything else).
   */
  userEdit?: string[]
  /**
   * What the service under a route checks besides the route's own
   * permission, written out here from the service's source.
   */
  service?: Permission[]
  /**
   * A settings patch the tool's effect makes: its permission must be exactly
   * what `settingsPatchAllowed`, which the settings route runs, needs for it.
   */
  patch?: Record<string, unknown>
  /** The row asks for any one of what its effects need, and nothing more. */
  anyOfEffects?: true
  /** What the `account` argument mirrors: the moderation routes. */
  moderation?: Mirror
}

/**
 * What each administration route asks of the session, as the PR 4 brief and
 * design 3.6 state it, written out by hand. The routes read
 * `ADMIN_PERMISSIONS`, and so does the catalog; this table is the test's
 * own, so a change to that shared table fails here instead of moving the
 * route and the tool together unnoticed.
 */
const ADMIN_ROUTE_PERMISSIONS: Record<string, readonly Permission[]> = {
  listUsers: ['users.read'],
  getUser: ['users.read'],
  createUser: ['users.create'],
  updateUser: ['users.update'],
  assignUserRoles: ['users.roles'],
  manageUserEmail: ['users.email'],
  listRoles: ['roles.manage', 'users.roles', 'users.read'],
  manageRoles: ['roles.manage'],
  listInvites: ['invites.create', 'invites.manage'],
  createInvite: ['invites.create'],
  revokeInvite: ['invites.create', 'invites.manage'],
  readSettings: ['settings.read'],
  setEveryoneCanInvite: ['settings.security'],
  manageEmailSettings: ['settings.email'],
  manageAppearance: ['appearance.manage'],
  readAuditLog: ['audit.read'],
}

/**
 * What a session-only route's handler asks of the session, from its source:
 * a quoted permission, or a key of `ADMIN_PERMISSIONS` read through the
 * test's own table above. A list means any one of them.
 */
function sessionRequirement(
  method: string,
  file: string
): readonly string[] | undefined {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  const start = source.indexOf(`export const ${method} = api(`)
  if (start < 0) return undefined
  const next = source.indexOf('\nexport const ', start + 1)
  const handler = source.slice(start, next < 0 ? undefined : next)
  const match =
    /await requireSession\(\s*request,\s*(?:'([^']+)'|ADMIN_PERMISSIONS\.(\w+))/.exec(
      handler
    )
  if (!match) return undefined
  if (match[1]) return [match[1]]
  const listed = ADMIN_ROUTE_PERMISSIONS[match[2]]
  if (!listed) throw new Error(`${file} reads ADMIN_PERMISSIONS.${match[2]}`)
  return listed
}

/** The permission a session-only route's handler requires, from its source. */
function sessionPermission(method: string, file: string): string | undefined {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  const start = source.indexOf(`export const ${method} = api(`)
  if (start < 0) return undefined
  const next = source.indexOf('\nexport const ', start + 1)
  const handler = source.slice(start, next < 0 ? undefined : next)
  return /await requireSession\(\s*request,\s*'([^']+)'/.exec(handler)?.[1]
}

const PROFILE_ROUTES = 'app/api/upload-profiles'
const USER_ROUTES = 'app/api/users'

/**
 * What each tool does over REST or in the dashboard today, per design 3.6.
 * The permissions are read from the tables the routes and the dashboard read,
 * not from the catalog.
 */
const MIRRORS: Record<ToolName, Mirror & { effects?: Record<string, Mirror> }> =
  {
    get_account: {
      effects: {
        // The limits are those of an upload, so they need what uploading needs.
        upload_limits: {
          actions: ['uploadFiles'],
          routes: [['POST', '/api/files']],
        },
        // Checked against the profile list route in its own test below.
        upload_profiles: {},
        manage_upload_profiles: {
          session: [['GET', `${PROFILE_ROUTES}/route.ts`]],
        },
        // Reading the settings needs what changing them over REST needs.
        profile_settings: { routes: [['PUT', '/api/profile']] },
      },
    },
    // Moderation mirrors the routes that act on another account's content.
    search_files: {
      actions: ['viewFiles'],
      routes: [['GET', '/api/files']],
      moderation: { session: [['GET', `${USER_ROUTES}/[id]/files/route.ts`]] },
    },
    get_file: {
      actions: ['viewFiles'],
      routes: [['GET', '/api/files']],
      moderation: { session: [['GET', `${USER_ROUTES}/[id]/files/route.ts`]] },
    },
    read_file: {
      actions: ['viewFiles'],
      moderation: { session: [['GET', `${USER_ROUTES}/[id]/files/route.ts`]] },
    },
    list_folders: { actions: ['viewFiles'], routes: [['GET', '/api/folders']] },
    list_tags: { actions: ['viewFiles'], routes: [['GET', '/api/tags']] },
    list_short_links: {
      actions: ['viewLinks'],
      routes: [['GET', '/api/urls']],
      moderation: { session: [['GET', `${USER_ROUTES}/[id]/urls/route.ts`]] },
    },
    upload_file: { actions: ['uploadFiles'], routes: [['POST', '/api/files']] },
    create_paste: { actions: ['createPaste'] },
    create_upload_url: {
      actions: ['uploadFiles'],
      routes: [
        ['POST', '/api/files'],
        ['POST', '/api/files/chunks'],
      ],
    },
    move_files: {
      actions: ['moveFiles'],
      routes: [['POST', '/api/files/folders']],
    },
    tag_files: {
      actions: ['tagFiles'],
      routes: [['PATCH', '/api/files/tags']],
    },
    set_file_expiry: {
      actions: ['manageExpiration'],
      routes: [
        ['POST', '/api/files/file-id/expiry'],
        ['DELETE', '/api/files/file-id/expiry'],
      ],
      effects: {
        delete: { actions: [EXPIRY_EFFECTS[ExpiryAction.DELETE]] },
        make_private: { actions: [EXPIRY_EFFECTS[ExpiryAction.SET_PRIVATE]] },
      },
    },
    set_file_sharing: {
      actions: ['shareFiles'],
      moderation: {
        session: [['PATCH', `${USER_ROUTES}/[id]/files/[fileId]/route.ts`]],
      },
    },
    delete_files: {
      actions: ['deleteFiles'],
      moderation: {
        session: [['DELETE', `${USER_ROUTES}/[id]/files/[fileId]/route.ts`]],
      },
    },
    save_folder: {
      actions: ['manageFolders'],
      routes: [
        ['POST', '/api/folders'],
        ['PATCH', '/api/folders/folder-id'],
      ],
    },
    delete_folder: {
      actions: ['manageFolders'],
      routes: [['DELETE', '/api/folders/folder-id']],
    },
    set_folder_sharing: { actions: ['shareFolders'] },
    save_tag: {
      routes: [
        ['POST', '/api/tags'],
        ['PATCH', '/api/tags/tag-id'],
      ],
      effects: {
        apply_rule_to_existing_files: {
          actions: ['applyTagRule'],
          routes: [['POST', '/api/tags/tag-id/apply']],
        },
      },
    },
    delete_tag: { routes: [['DELETE', '/api/tags/tag-id']] },
    create_short_link: { routes: [['POST', '/api/urls']] },
    update_short_link: { routes: [['PATCH', '/api/urls/link-id']] },
    delete_short_link: {
      routes: [['DELETE', '/api/urls/link-id']],
      moderation: {
        session: [['DELETE', `${USER_ROUTES}/[id]/urls/[urlId]/route.ts`]],
      },
    },
    extract_archive: { actions: ['extractArchive'] },
    create_archive: { actions: ['createArchive'] },
    update_profile: {
      routes: [['PUT', '/api/profile']],
      session: [['POST', 'app/api/profile/avatar/route.ts']],
      effects: {
        theme_mode: {
          session: [['PATCH', 'app/api/customization/preferences/route.ts']],
        },
        embed: { session: [['PATCH', 'app/api/profile/embed/route.ts']] },
        default_expiry_delete: {
          actions: [EXPIRY_EFFECTS[ExpiryAction.DELETE]],
        },
        default_expiry_make_private: {
          actions: [EXPIRY_EFFECTS[ExpiryAction.SET_PRIVATE]],
        },
        // The avatar is a readable copy of the file, and a public one.
        avatar_file: { actions: ['viewFiles'] },
        avatar_private_file: { actions: ['shareFiles'] },
      },
    },
    save_upload_profile: {
      session: [
        ['POST', `${PROFILE_ROUTES}/route.ts`],
        ['PUT', `${PROFILE_ROUTES}/[id]/route.ts`],
        ['PUT', `${PROFILE_ROUTES}/default/route.ts`],
      ],
      effects: {
        expiry_delete: { actions: [EXPIRY_EFFECTS[ExpiryAction.DELETE]] },
        expiry_make_private: {
          actions: [EXPIRY_EFFECTS[ExpiryAction.SET_PRIVATE]],
        },
        // Publishing later uploads is what making a file public needs.
        visibility_public: { actions: ['shareFiles'] },
      },
    },
    delete_upload_profile: {
      session: [['DELETE', `${PROFILE_ROUTES}/[id]/route.ts`]],
      effects: {
        expiry_delete: { actions: [EXPIRY_EFFECTS[ExpiryAction.DELETE]] },
        expiry_make_private: {
          actions: [EXPIRY_EFFECTS[ExpiryAction.SET_PRIVATE]],
        },
        // Publishing later uploads is what making a file public needs.
        visibility_public: { actions: ['shareFiles'] },
      },
    },
    export_account: {
      actions: ['exportAccount'],
      routes: [['GET', '/api/profile/export']],
    },
    list_invites: {
      session: [['GET', 'app/api/invites/route.ts']],
      // lib/invites/service.ts: the `all` scope needs `invites.manage`.
      effects: { all: { service: ['invites.manage'] } },
    },
    create_invite: {
      session: [['POST', 'app/api/invites/route.ts']],
      // lib/invites/service.ts: an invite with roles needs `users.roles`.
      effects: { roles: { service: ['users.roles'] } },
    },
    revoke_invite: { session: [['DELETE', 'app/api/invites/[id]/route.ts']] },
    list_users: {
      session: [['GET', `${USER_ROUTES}/route.ts`]],
      effects: {
        email_status: {
          session: [['GET', `${USER_ROUTES}/[id]/email/route.ts`]],
        },
      },
    },
    get_user: {
      session: [
        ['GET', `${USER_ROUTES}/route.ts`],
        ['POST', `${USER_ROUTES}/[id]/login/route.ts`],
      ],
      effects: {
        email_status: {
          session: [['GET', `${USER_ROUTES}/[id]/email/route.ts`]],
        },
      },
    },
    list_roles: { session: [['GET', 'app/api/roles/route.ts']] },
    get_instance_settings: {
      session: [
        ['GET', 'app/api/settings/invites/route.ts'],
        ['GET', 'app/api/updates/check/route.ts'],
      ],
      effects: {
        email: { session: [['GET', 'app/api/settings/email/route.ts']] },
      },
    },
    search_audit_log: { session: [['GET', 'app/api/audit/route.ts']] },
    create_user: {
      session: [['POST', `${USER_ROUTES}/route.ts`]],
      effects: { roles: { userEdit: ['roleIds'] } },
    },
    update_user: {
      anyOfEffects: true,
      effects: {
        profile: {
          userEdit: ['name', 'urlId', 'vanityId'],
          session: [['DELETE', `${USER_ROUTES}/[id]/avatar/route.ts`]],
        },
        roles: { userEdit: ['roleIds'] },
        email_verification: {
          session: [['POST', `${USER_ROUTES}/[id]/email/route.ts`]],
        },
        sign_out: {
          session: [['DELETE', `${USER_ROUTES}/[id]/sessions/route.ts`]],
        },
      },
    },
    delete_user: { session: [['DELETE', `${USER_ROUTES}/[id]/route.ts`]] },
    save_role: {
      session: [
        ['POST', 'app/api/roles/route.ts'],
        ['PATCH', 'app/api/roles/[id]/route.ts'],
      ],
    },
    delete_role: { session: [['DELETE', 'app/api/roles/[id]/route.ts']] },
    update_instance_settings: {
      anyOfEffects: true,
      effects: {
        registrations: {
          patch: { general: { registrations: { enabled: true } } },
        },
        storage: { patch: { general: { storage: { provider: 'local' } } } },
        credits: { patch: { general: { credits: { showFooter: false } } } },
        ocr: { patch: { general: { ocr: { enabled: false } } } },
        theme: {
          patch: { appearance: { theme: 'dark', customColors: {} } },
        },
        // lib/invites/service.ts: the account must hold `invites.create`.
        everyone_can_invite: {
          session: [['PUT', 'app/api/settings/invites/route.ts']],
          service: ['invites.create'],
        },
      },
    },
    update_email_settings: {
      session: [['PUT', 'app/api/settings/email/route.ts']],
    },
    send_test_email: {
      session: [['POST', 'app/api/settings/email/test/route.ts']],
    },
    update_instance_appearance: {
      session: [['POST', 'app/api/customization/route.ts']],
    },
  }

function expectMirrors(needs: ToolNeeds, mirror: Mirror, what: string) {
  for (const action of mirror.actions ?? [])
    expect(
      sorted(needs.permissions),
      `${what} against the ${action} action`
    ).toEqual(sorted(ACTION_PERMISSIONS[action]))
  for (const [method, path] of mirror.routes ?? []) {
    const permissions = requestPermissions(method, path)
    expect(permissions, `${method} ${path} is an account route`).not.toBeNull()
    expect(
      sorted(needs.permissions),
      `${what} against ${method} ${path}`
    ).toEqual(sorted(permissions!))
    // A scope the REST API already honors means the same thing through MCP.
    const restScope = requiredApiScope(method, path)
    if (restScope)
      expect(needs.scopes, `${what} against ${method} ${path}`).toEqual([
        restScope,
      ])
  }
  // Session routes, user edit fields and service checks add up: the tool
  // needs every one of them, or any one of a route's alternatives.
  const required = new Set<string>(mirror.service ?? [])
  let alternatives: readonly string[] | undefined
  for (const [method, file] of mirror.session ?? []) {
    const requirement = sessionRequirement(method, file)
    expect(requirement, `${method} in ${file} requires a permission`).toEqual(
      expect.any(Array)
    )
    if (requirement!.length > 1) {
      expect(
        alternatives ?? requirement,
        `${what}: one list of alternatives`
      ).toEqual(requirement)
      alternatives = requirement
    } else required.add(requirement![0])
  }
  for (const field of mirror.userEdit ?? [])
    required.add(userUpdatePermission([field]))
  if (mirror.session?.length || mirror.userEdit || mirror.service) {
    expect(sorted(needs.permissions), what).toEqual(sorted([...required]))
    expect(sorted(needs.anyPermission ?? []), what).toEqual(
      sorted(alternatives ?? [])
    )
  }
  if (mirror.patch) {
    // Exactly one permission, and it is what the settings patch needs.
    expect(needs.permissions, what).toHaveLength(1)
    const [permission] = needs.permissions
    expect(
      settingsPatchAllowed({ permissions: [permission] }, mirror.patch),
      what
    ).toBe(true)
    expect(
      settingsPatchAllowed(
        { permissions: without(ORDINARY_PERMISSIONS, permission) },
        mirror.patch
      ),
      `${what} without ${permission}`
    ).toBe(false)
  }
}

describe('the authorization matrix', () => {
  const expectDesign = (
    needs: ToolNeeds | undefined,
    design: Needs,
    what: string
  ) => {
    expect(needs, what).toBeDefined()
    expect([...needs!.scopes], what).toEqual(design.scopes)
    expect(sorted(needs!.permissions), what).toEqual(sorted(design.permissions))
    expect(sorted(needs!.anyPermission ?? []), what).toEqual(
      sorted(design.anyPermission ?? [])
    )
  }

  it.each(rows)('%s needs what the approved design says', (name, row) => {
    const design = DESIGN[name]
    expectDesign(row, design, name)
    expect(Object.keys(row.effects ?? {}).sort()).toEqual(
      Object.keys(design.effects ?? {}).sort()
    )
    for (const [effect, needs] of Object.entries(design.effects ?? {}))
      expectDesign(row.effects![effect], needs, `${name}.${effect}`)
    expect(Boolean(row.moderation), `${name} moderation`).toBe(
      Boolean(design.moderation)
    )
    if (design.moderation)
      expectDesign(row.moderation, design.moderation, `${name} moderation`)
  })

  it('reads from ADMIN_PERMISSIONS what the brief says each administration route asks', () => {
    expect(ADMIN_PERMISSIONS).toEqual(ADMIN_ROUTE_PERMISSIONS)
  })

  it.each(rows)(
    '%s needs the role permissions of the REST route or dashboard action it mirrors',
    (name, row) => {
      const mirror = MIRRORS[name]
      expectMirrors(row, mirror, name)
      expect(Object.keys(row.effects ?? {}).sort()).toEqual(
        Object.keys(mirror.effects ?? {}).sort()
      )
      for (const [effect, effectMirror] of Object.entries(mirror.effects ?? {}))
        expectMirrors(row.effects![effect], effectMirror, `${name}.${effect}`)
      if (mirror.anyOfEffects) {
        // A call needs what it asks for; the tool, what some call could use.
        expect(row.permissions, name).toEqual([])
        const effectNeeds = Object.values(row.effects ?? {})
        for (const needs of effectNeeds)
          expect(
            needsMet(row, subject(row.scopes, needs.permissions)),
            `${name} with ${needs.permissions.join(', ')}`
          ).toBe(true)
        // And each alternative alone is enough for one of them.
        for (const permission of row.anyPermission ?? [])
          expect(
            effectNeeds.some(
              (needs) =>
                needs.permissions.length === 1 &&
                needs.permissions[0] === permission
            ),
            `${name}: ${permission} alone does something`
          ).toBe(true)
      }
      expect(Boolean(row.moderation), `${name} moderation`).toBe(
        Boolean(mirror.moderation)
      )
      if (mirror.moderation)
        expectMirrors(row.moderation!, mirror.moderation, `${name} moderation`)
    }
  )

  it('reads what an administration route asks of the session from its handler', () => {
    expect(
      sessionRequirement('DELETE', `${USER_ROUTES}/[id]/route.ts`)
    ).toEqual(['users.delete'])
    expect(sessionRequirement('GET', 'app/api/roles/route.ts')).toEqual([
      'roles.manage',
      'users.roles',
      'users.read',
    ])
    // A handler that checks only after reading the body asks nothing first.
    expect(sessionRequirement('PUT', `${USER_ROUTES}/route.ts`)).toBeUndefined()
    expect(userUpdatePermission(['roleIds'])).toBe('users.roles')
    expect(userUpdatePermission(['name', 'roleIds'])).toBe('users.update')
  })

  it('lists every tool that has a REST route or dashboard action to mirror', () => {
    const unmirrored = TOOL_NAMES.filter(
      (name) =>
        !MIRRORS[name].actions?.length &&
        !MIRRORS[name].routes?.length &&
        !MIRRORS[name].session?.length &&
        !MIRRORS[name].anyOfEffects
    )
    // Only the tool that describes the connection itself has neither.
    expect(unmirrored).toEqual(['get_account'])
  })

  it('needs for the upload profile list what the profile list route requires', () => {
    // The route is session-only, so the bearer route table does not hold it.
    const route = readFileSync(
      resolve(process.cwd(), 'app/api/upload-profiles/route.ts'),
      'utf8'
    )
    const required =
      /export const GET = api\(async \(request\) => \{\s*const \{ user \} = await requireSession\(request, '([^']+)'\)/.exec(
        route
      )?.[1]
    expect(required).toBe('uploadProfiles.manage')
    // What the route requires, and what uploading with a profile requires.
    expect(
      sorted(TOOL_CATALOG.get_account.effects.upload_profiles.permissions)
    ).toEqual(sorted([...ACTION_PERMISSIONS.uploadFiles, required!]))
    expect(TOOL_CATALOG.get_account.effects.upload_profiles.scopes).toEqual(
      TOOL_CATALOG.upload_file.scopes
    )
  })

  it('shows upload limits and profiles only to a connection that could upload', () => {
    const { effects } = TOOL_CATALOG.get_account
    const upload = TOOL_CATALOG.upload_file
    // Whoever sees the limits may call upload_file, and the other way round.
    expect(effects.upload_limits).toEqual({
      scopes: upload.scopes,
      permissions: upload.permissions,
    })
    const scoped = (permissions: Permission[]) =>
      subject(['files:upload'], permissions)
    expect(needsMet(effects.upload_limits, scoped(['files.upload']))).toBe(true)
    expect(needsMet(effects.upload_limits, scoped([]))).toBe(false)
    expect(
      needsMet(effects.upload_profiles, scoped(['uploadProfiles.manage']))
    ).toBe(false)
    expect(needsMet(effects.upload_profiles, scoped(['files.upload']))).toBe(
      false
    )
    expect(
      needsMet(
        effects.upload_profiles,
        scoped(['files.upload', 'uploadProfiles.manage'])
      )
    ).toBe(true)
  })

  it('reads the permission a session-only route requires from its handler', () => {
    expect(sessionPermission('GET', `${PROFILE_ROUTES}/route.ts`)).toBe(
      'uploadProfiles.manage'
    )
    expect(
      sessionPermission('PATCH', 'app/api/customization/preferences/route.ts')
    ).toBe('appearance.personal')
    // A method the file does not answer, and a handler that requires nothing.
    expect(
      sessionPermission('DELETE', `${PROFILE_ROUTES}/route.ts`)
    ).toBeUndefined()
    expect(
      sessionPermission('GET', 'app/api/customization/preferences/route.ts')
    ).toBeUndefined()
  })

  it('lists upload profiles with their settings to a connection that may change them, uploading or not', () => {
    const { effects } = TOOL_CATALOG.get_account
    const save = TOOL_CATALOG.save_upload_profile
    // Whoever may call save_upload_profile sees what there is to save.
    expect(effects.manage_upload_profiles).toEqual({
      scopes: save.scopes,
      permissions: save.permissions,
    })
    expect(TOOL_CATALOG.delete_upload_profile.scopes).toEqual(save.scopes)
    expect(TOOL_CATALOG.delete_upload_profile.permissions).toEqual(
      save.permissions
    )
    const manages = (scopes: string[], permissions: Permission[]) =>
      needsMet(effects.manage_upload_profiles, subject(scopes, permissions))
    expect(manages(['account:write'], ['uploadProfiles.manage'])).toBe(true)
    // Uploading is neither needed nor enough.
    expect(
      manages(['files:upload'], ['files.upload', 'uploadProfiles.manage'])
    ).toBe(false)
    expect(manages(['account:write'], ['profile.update', 'files.upload'])).toBe(
      false
    )
    expect(
      needsMet(
        effects.upload_profiles,
        subject(['account:write'], ['uploadProfiles.manage'])
      )
    ).toBe(false)
  })

  it('gives a default expiry what an expiry on a file needs', () => {
    const { effects } = TOOL_CATALOG.update_profile
    const expiry = TOOL_CATALOG.set_file_expiry.effects
    expect(effects.default_expiry_delete).toEqual(expiry.delete)
    expect(effects.default_expiry_make_private).toEqual(expiry.make_private)
    // The theme and the embed are the account's own: no scope beyond the
    // tool's, only the role permission their routes require.
    expect(effects.theme_mode.scopes).toEqual([])
    expect(effects.embed.scopes).toEqual([])
    expect(Object.keys(effects).sort()).toEqual([
      'avatar_file',
      'avatar_private_file',
      'default_expiry_delete',
      'default_expiry_make_private',
      'embed',
      'theme_mode',
    ])
  })

  it("gives a profile's expiry what an expiry on a file needs, as the account default has", () => {
    const { effects } = TOOL_CATALOG.save_upload_profile
    const expiry = TOOL_CATALOG.set_file_expiry.effects
    const defaults = TOOL_CATALOG.update_profile.effects
    expect(effects.expiry_delete).toEqual(expiry.delete)
    expect(effects.expiry_make_private).toEqual(expiry.make_private)
    // A default profile acts on the same uploads the account default does.
    expect(effects.expiry_delete).toEqual(defaults.default_expiry_delete)
    expect(effects.expiry_make_private).toEqual(
      defaults.default_expiry_make_private
    )
    expect(Object.keys(effects).sort()).toEqual([
      'expiry_delete',
      'expiry_make_private',
      'visibility_public',
    ])
    // Making later uploads public needs what making a file public does.
    const sharing = TOOL_CATALOG.set_file_sharing
    expect(effects.visibility_public).toEqual({
      scopes: sharing.scopes,
      permissions: sharing.permissions,
    })
    // The row alone still saves a profile that never expires.
    const save = TOOL_CATALOG.save_upload_profile
    const plain = subject(save.scopes, save.permissions)
    expect(toolAllowed('save_upload_profile', plain)).toBe(true)
    expect(needsMet(effects.expiry_delete, plain)).toBe(false)
    expect(needsMet(effects.expiry_make_private, plain)).toBe(false)
    // Deleting the default profile can hand uploads to the account's own
    // expiry, so deleting needs what saving does for the same outcome.
    expect(TOOL_CATALOG.delete_upload_profile.effects).toEqual(effects)
    expect(
      needsMet(TOOL_CATALOG.delete_upload_profile.effects.expiry_delete, plain)
    ).toBe(false)
  })

  it('gives an avatar what reading a file needs, and one from a hidden file what publishing it needs', () => {
    const { effects } = TOOL_CATALOG.update_profile
    // An avatar is a copy anyone can load, so choosing one reads the file.
    expect(effects.avatar_file).toEqual({
      scopes: TOOL_CATALOG.read_file.scopes,
      permissions: TOOL_CATALOG.read_file.permissions,
    })
    // And a file that is not public is made public by it.
    expect(effects.avatar_private_file).toEqual({
      scopes: TOOL_CATALOG.set_file_sharing.scopes,
      permissions: TOOL_CATALOG.set_file_sharing.permissions,
    })
    const row = TOOL_CATALOG.update_profile
    const settingsOnly = subject(row.scopes, row.permissions)
    expect(toolAllowed('update_profile', settingsOnly)).toBe(true)
    expect(needsMet(effects.avatar_file, settingsOnly)).toBe(false)
    // Reading contents is not enough for a file that is hidden.
    const reader = subject(
      [...row.scopes, 'files:content'],
      [...row.permissions, 'files.read']
    )
    expect(needsMet(effects.avatar_file, reader)).toBe(true)
    expect(needsMet(effects.avatar_private_file, reader)).toBe(false)
  })

  it('shows the account settings to exactly the connections that may change them', () => {
    const { effects } = TOOL_CATALOG.get_account
    const update = TOOL_CATALOG.update_profile
    expect(effects.profile_settings).toEqual({
      scopes: update.scopes,
      permissions: update.permissions,
    })
    for (const candidate of [
      subject(['account:write'], ['profile.update']),
      subject(['account:write'], ['uploadProfiles.manage']),
      subject(['files:read', 'files:content'], ['profile.update']),
      subject(ALL_SCOPES, ORDINARY_PERMISSIONS),
      subject([], ['administrator']),
    ])
      expect(needsMet(effects.profile_settings, candidate)).toBe(
        toolAllowed('update_profile', candidate)
      )
  })

  it('gives an expiry what it does when it runs: delete needs deleting, make_private needs sharing', () => {
    const { effects } = TOOL_CATALOG.set_file_expiry
    expect(effects.delete).toEqual({
      scopes: ['files:delete'],
      permissions: ACTION_PERMISSIONS.deleteFiles,
    })
    expect(effects.make_private).toEqual({
      scopes: ['files:share'],
      permissions: ACTION_PERMISSIONS.shareFiles,
    })
    // The same needs as the tools that do those things directly.
    expect(effects.delete).toEqual({
      scopes: TOOL_CATALOG.delete_files.scopes,
      permissions: TOOL_CATALOG.delete_files.permissions,
    })
    expect(effects.make_private).toEqual({
      scopes: TOOL_CATALOG.set_file_sharing.scopes,
      permissions: TOOL_CATALOG.set_file_sharing.permissions,
    })
    // Cancelling an expiry is neither effect, so a connection that may only
    // organize can still do it.
    expect(Object.keys(effects).sort()).toEqual(['delete', 'make_private'])
    // Every expiry action Flare has is one of the effects.
    expect(sorted(Object.values(EXPIRY_EFFECTS))).toEqual([
      'deleteFiles',
      'shareFiles',
    ])
  })
})

describe('annotations', () => {
  const tools = (pick: (row: ToolRow) => boolean) =>
    TOOL_NAMES.filter((name) => pick(TOOL_CATALOG[name]))

  it('marks exactly the read tools as read-only, and none of them destructive', () => {
    const readTools = tools(({ annotations }) => annotations.readOnly)
    expect(readTools).toEqual([
      'get_account',
      'search_files',
      'get_file',
      'read_file',
      'list_folders',
      'list_tags',
      'list_short_links',
      // It hands out a download of everything and changes nothing.
      'export_account',
      'list_invites',
      'list_users',
      'get_user',
      'list_roles',
      'get_instance_settings',
      'search_audit_log',
    ])
    for (const name of readTools) {
      const { annotations }: ToolRow = TOOL_CATALOG[name]
      expect(annotations.destructive, name).toBe(false)
      // A call that changes nothing changes nothing more when repeated.
      expect(annotations.idempotent, name).toBe(true)
      expect(annotations.openWorld, name).toBe(false)
    }
  })

  it("marks exactly the design's destructive tools as destructive", () => {
    expect(tools(({ annotations }) => annotations.destructive)).toEqual([
      'set_file_expiry',
      'set_file_sharing',
      'delete_files',
      'delete_folder',
      'set_folder_sharing',
      'delete_tag',
      // Everyone who has the short URL goes somewhere new.
      'update_short_link',
      'delete_short_link',
      // A default expiry can delete later uploads, a new vanity ID breaks
      // links, and an avatar is public; a profile's expiry deletes too.
      'update_profile',
      'save_upload_profile',
      'delete_upload_profile',
      'revoke_invite',
      // Every administration write, whatever it changes.
      'create_user',
      'update_user',
      'delete_user',
      'save_role',
      'delete_role',
      'update_instance_settings',
      'update_email_settings',
      'update_instance_appearance',
    ])
  })

  it('marks every administration write destructive, but the test email and a plain invite', () => {
    const writes = TOOL_NAMES.filter((name) => {
      const row: ToolRow = TOOL_CATALOG[name]
      return (
        !row.annotations.readOnly &&
        row.scopes.some((scope) => scope.startsWith('admin:'))
      )
    })
    expect(
      writes.filter((name) => !TOOL_CATALOG[name].annotations.destructive)
    ).toEqual(['send_test_email'])
    // Sending mail destroys nothing, but it leaves Flare.
    expect(TOOL_CATALOG.send_test_email.annotations).toEqual({
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: true,
    })
    // An invite on its own adds a way in that can be revoked.
    expect(TOOL_CATALOG.create_invite.annotations).toEqual({
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: false,
    })
    expect(TOOL_CATALOG.revoke_invite.annotations.destructive).toBe(true)
  })

  it('marks the account tools by what a repeated call does', () => {
    // The same settings saved twice are the same settings.
    expect(TOOL_CATALOG.update_profile.annotations).toEqual({
      readOnly: false,
      destructive: true,
      idempotent: true,
      openWorld: false,
    })
    // Without `profile`, the same call creates a second profile or fails.
    expect(TOOL_CATALOG.save_upload_profile.annotations).toEqual({
      readOnly: false,
      destructive: true,
      idempotent: false,
      openWorld: false,
    })
    expect(TOOL_CATALOG.delete_upload_profile.annotations).toEqual({
      readOnly: false,
      destructive: true,
      idempotent: true,
      openWorld: false,
    })
  })

  it('marks no tool both read-only and destructive', () => {
    expect(
      tools(
        ({ annotations }) => annotations.readOnly && annotations.destructive
      )
    ).toEqual([])
  })

  it('marks the tools that publish or follow an outside URL as open world', () => {
    expect(tools(({ annotations }) => annotations.openWorld)).toEqual([
      'set_file_sharing',
      'set_folder_sharing',
      'create_short_link',
      'update_short_link',
      'send_test_email',
    ])
  })

  it.each(rows)('%s states all four hints', (_name, row) => {
    expect(Object.keys(row.annotations).sort()).toEqual([
      'destructive',
      'idempotent',
      'openWorld',
      'readOnly',
    ])
    for (const hint of Object.values(row.annotations))
      expect(typeof hint).toBe('boolean')
  })
})

/** Every route file under app/api as `[methods, example path]`. */
function apiOperations(): [method: string, path: string][] {
  const app = resolve(process.cwd(), 'app')
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : [join(directory, entry.name)]
    )
  return walk(join(app, 'api'))
    .filter((file) => file.endsWith('/route.ts'))
    .flatMap((file) => {
      // Named tokens match only IDs of letters, digits, `_` and `-`.
      const path =
        '/' +
        relative(app, file)
          .replace(/\/route\.ts$/, '')
          .replace(/\[[^\]]+\]/g, '1')
      return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(
        (method) => [method, path] as [string, string]
      )
    })
}

describe('where a scope works', () => {
  const restScopes = [
    ...new Set(
      apiOperations()
        .map(([method, path]) => requiredApiScope(method, path))
        .filter((scope) => scope !== null)
    ),
  ]

  it('finds the scopes named tokens use over REST', () => {
    expect(sorted(restScopes)).toEqual([
      'files:read',
      'files:upload',
      'urls:read',
      'urls:write',
    ])
  })

  it('lists `api` for every scope a bearer route uses, and for no other', () => {
    for (const { scope, surfaces } of API_SCOPE_CATALOG) {
      const overRest = restScopes.includes(scope)
      expect((surfaces as readonly string[]).includes('api'), scope).toBe(
        overRest
      )
      expect(scopeWorksOverApi(scope), scope).toBe(overRest)
      // A scope is usable over REST exactly when a bearer route asks for it.
      expect(
        scopeUsable(scope, () => true),
        scope
      ).toBe(overRest)
    }
    expect(scopeWorksOverApi('not:a-scope')).toBe(false)
  })

  it('has no bearer route for a scope only MCP honors', () => {
    const mcpOnly = API_SCOPE_CATALOG.filter(
      ({ surfaces }) => !(surfaces as readonly string[]).includes('api')
    ).map(({ scope }) => scope)
    expect(mcpOnly).toEqual([
      'files:content',
      'files:organize',
      'files:share',
      'files:delete',
      'account:write',
      'invites:write',
      'admin:read',
      'admin:users',
      'admin:content',
      'admin:settings',
      'mcp',
    ])
    for (const scope of mcpOnly) {
      expect(restScopes).not.toContain(scope)
      expect(
        scopeUsable(scope, () => true),
        scope
      ).toBe(false)
    }
  })

  it('lists `mcp` for every scope a tool or effect needs, and uses every such scope', () => {
    const needed = new Set<string>()
    for (const name of TOOL_NAMES) {
      const row: ToolRow = TOOL_CATALOG[name]
      for (const needs of [
        row,
        ...Object.values(row.effects ?? {}),
        ...(row.moderation ? [row.moderation] : []),
      ])
        for (const scope of needs.scopes) needed.add(scope)
    }
    expect(MCP_SCOPES).toEqual(
      API_SCOPE_CATALOG.filter(({ surfaces }) =>
        (surfaces as readonly string[]).includes('mcp')
      ).map(({ scope }) => scope)
    )
    for (const scope of needed) expect(MCP_SCOPES).toContain(scope)
    // The marker opens the endpoint; no tool asks for it.
    expect(needed.has(MCP_SCOPE)).toBe(false)
    expect(sorted([...needed, MCP_SCOPE])).toEqual(sorted(MCP_SCOPES))
  })
})

describe('scopeAvailable', () => {
  const can = (granted: readonly Permission[]) => (permission: Permission) =>
    hasPermission({ permissions: granted }, permission)
  const restScopes = API_SCOPE_CATALOG.filter(({ surfaces }) =>
    (surfaces as readonly string[]).includes('api')
  ).map(({ scope }) => scope)
  /** No permission, each permission alone, and all of them. */
  const roles: Permission[][] = [
    [],
    ...ORDINARY_PERMISSIONS.map((permission) => [permission]),
    [...ORDINARY_PERMISSIONS],
    ['administrator'],
  ]

  it('offers a REST scope exactly when the REST rule does, while MCP is off', () => {
    for (const scope of restScopes)
      for (const granted of roles)
        expect(
          scopeAvailable(scope, can(granted), false),
          `${scope} with ${granted.join(', ') || 'no permission'}`
        ).toBe(scopeUsable(scope, can(granted)))
  })

  it('offers a REST scope exactly when the REST rule does, while MCP is on', () => {
    for (const scope of restScopes)
      for (const granted of roles)
        expect(
          scopeAvailable(scope, can(granted), true),
          `${scope} with ${granted.join(', ') || 'no permission'}`
        ).toBe(scopeUsable(scope, can(granted)))
  })

  it('never offers a scope only MCP honors while MCP is off', () => {
    for (const scope of without(MCP_SCOPES, MCP_SCOPE).filter(
      (candidate) => !restScopes.includes(candidate)
    ))
      for (const granted of roles)
        expect(scopeAvailable(scope, can(granted), false), scope).toBe(false)
  })

  it.each<[ApiScope, Permission[][], Permission[][]]>([
    [
      'files:content',
      [['files.read']],
      [[], ['files.upload'], without(ORDINARY_PERMISSIONS, 'files.read')],
    ],
    [
      'files:organize',
      // Expiry, folders and tags each stand alone.
      [['files.update'], ['folders.manage'], ['tags.manage']],
      [
        [],
        ['files.read'],
        ['files.share', 'files.delete', 'folders.share'],
        ORDINARY_PERMISSIONS.filter(
          (permission) =>
            !['files.update', 'folders.manage', 'tags.manage'].includes(
              permission
            )
        ),
      ],
    ],
    [
      'files:share',
      [['files.share'], ['folders.manage', 'folders.share']],
      [
        [],
        // A folder link needs both folder permissions.
        ['folders.share'],
        ['folders.manage'],
        // Expiry that makes a file private still needs the sharing permission.
        ['files.update'],
        ORDINARY_PERMISSIONS.filter(
          (permission) => !['files.share', 'folders.share'].includes(permission)
        ),
      ],
    ],
    [
      'files:delete',
      [['files.delete']],
      [
        [],
        ['files.update'],
        ['links.delete'],
        without(ORDINARY_PERMISSIONS, 'files.delete'),
      ],
    ],
    [
      'account:write',
      // The profile and the upload profiles each stand alone.
      [['profile.update'], ['uploadProfiles.manage']],
      [
        [],
        ['files.read'],
        // What an argument of update_profile needs is no use without the tool.
        ['appearance.personal', 'files.share', 'files.delete'],
        ORDINARY_PERMISSIONS.filter(
          (permission) =>
            !['profile.update', 'uploadProfiles.manage'].includes(permission)
        ),
      ],
    ],
  ])(
    'offers %s while MCP is on only to a role that could use it',
    (scope, enough, notEnough) => {
      for (const granted of enough)
        expect(
          scopeAvailable(scope, can(granted), true),
          `with ${granted.join(', ')}`
        ).toBe(true)
      for (const granted of notEnough)
        expect(
          scopeAvailable(scope, can(granted), true),
          `with ${granted.join(', ') || 'no permission'}`
        ).toBe(false)
      expect(scopeAvailable(scope, can(['administrator']), true)).toBe(true)
    }
  )

  it('offers the marker exactly while MCP is on, whatever the role allows', () => {
    for (const granted of roles) {
      expect(scopeAvailable(MCP_SCOPE, can(granted), true)).toBe(true)
      expect(scopeAvailable(MCP_SCOPE, can(granted), false)).toBe(false)
    }
  })

  const ADMIN = ['admin:read', 'admin:users', 'admin:content', 'admin:settings']

  it('never offers an administration scope while administration through MCP is off', () => {
    for (const scope of ADMIN)
      for (const granted of roles) {
        expect(scopeAvailable(scope, can(granted), true), scope).toBe(false)
        expect(scopeAvailable(scope, can(granted), true, false), scope).toBe(
          false
        )
        // Nor while the server itself is off.
        expect(scopeAvailable(scope, can(granted), false, true), scope).toBe(
          false
        )
      }
  })

  it.each<[string, Permission[][], Permission[][]]>([
    [
      'invites:write',
      [['invites.create'], ['invites.manage']],
      [[], ['users.create'], ['users.roles'], ['settings.security']],
    ],
    [
      'admin:read',
      [
        ['users.read'],
        ['roles.manage'],
        ['users.roles'],
        ['settings.read'],
        ['audit.read'],
      ],
      [
        [],
        ['files.read'],
        ['users.email'],
        ['settings.email'],
        ['content.read'],
      ],
    ],
    [
      'admin:users',
      [
        ['users.create'],
        ['users.update'],
        ['users.roles'],
        ['users.email'],
        ['users.sessions'],
        ['users.delete'],
        ['roles.manage'],
      ],
      [[], ['users.read'], ['invites.create'], ['content.delete']],
    ],
    [
      'admin:content',
      [['content.read'], ['content.update'], ['content.delete']],
      [[], ['files.read', 'files.delete'], ['users.read']],
    ],
    [
      'admin:settings',
      [
        ['settings.security'],
        ['settings.storage'],
        ['settings.general'],
        ['settings.email'],
        ['appearance.manage'],
      ],
      [[], ['settings.read'], ['appearance.personal'], ['invites.create']],
    ],
  ])(
    'offers %s while administration is on only to a role that could use it',
    (scope, enough, notEnough) => {
      for (const granted of enough)
        expect(
          scopeAvailable(scope, can(granted), true, true),
          `with ${granted.join(', ')}`
        ).toBe(true)
      for (const granted of notEnough)
        expect(
          scopeAvailable(scope, can(granted), true, true),
          `with ${granted.join(', ') || 'no permission'}`
        ).toBe(false)
      expect(scopeAvailable(scope, can(['administrator']), true, true)).toBe(
        true
      )
    }
  )

  it('offers invites without administration: they act on what the account may do itself', () => {
    expect(scopeAvailable('invites:write', can(['invites.create']), true)).toBe(
      true
    )
    expect(
      scopeAvailable('invites:write', can(['invites.create']), false)
    ).toBe(false)
  })

  it('never offers a scope that does not exist', () => {
    expect(scopeAvailable('files:everything', () => true, true)).toBe(false)
    expect(scopeAvailable('', () => true, true)).toBe(false)
  })
})
