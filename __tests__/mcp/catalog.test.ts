import { ExpiryAction } from '@/types/events'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

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
  needsMet,
  scopeAvailable,
  toolAllowed,
} from '@/lib/mcp/catalog'
import {
  ACTION_PERMISSIONS,
  type Action,
  EXPIRY_EFFECTS,
} from '@/lib/permissions/actions'
import {
  ALL_PERMISSIONS,
  type Permission,
  hasPermission,
} from '@/lib/permissions/catalog'

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

/** The three ways the design asks every row and effect to be tested. */
function expectNeedsEnforced(needs: ToolNeeds) {
  // Exactly what is asked for, and nothing else, is enough.
  expect(needsMet(needs, subject(needs.scopes, needs.permissions))).toBe(true)
  expect(missingNeeds(needs, subject(needs.scopes, needs.permissions))).toEqual(
    { scopes: [], permissions: [] }
  )
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
  it('name exactly the same tools, each once', async () => {
    const { TOOLS } = await import('@/lib/mcp/tools')
    const defined = TOOLS.map((tool) => tool.name)
    expect(new Set(defined).size, 'a tool is defined twice').toBe(
      defined.length
    )
    expect(sorted(defined)).toEqual(sorted(TOOL_NAMES))
  })

  it('has the 22 content tools of the first change, in the order clients list them', () => {
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
      'delete_short_link',
    ])
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
      expect(toolAllowed(name, subject(row.scopes, row.permissions))).toBe(true)
      for (const scope of row.scopes)
        expect(
          toolAllowed(
            name,
            subject(without(ALL_SCOPES, scope), ORDINARY_PERMISSIONS)
          )
        ).toBe(false)
      for (const permission of row.permissions)
        expect(
          toolAllowed(
            name,
            subject(ALL_SCOPES, without(ORDINARY_PERMISSIONS, permission))
          )
        ).toBe(false)
    }
  )

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

type Needs = { scopes: ApiScope[]; permissions: Permission[] }

/**
 * Design 3.6, written out by hand: the scope and the role permissions each
 * tool and effect needs. A row that drifts from the approved table fails here.
 * One refinement since: upload limits and upload profiles are shown only to
 * an account that may upload, so both also need `files.upload`. A scope that
 * works over REST is then offered for MCP to exactly the same roles.
 */
const DESIGN: Record<ToolName, Needs & { effects?: Record<string, Needs> }> = {
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
    },
  },
  search_files: { scopes: ['files:read'], permissions: ['files.read'] },
  get_file: { scopes: ['files:read'], permissions: ['files.read'] },
  read_file: { scopes: ['files:content'], permissions: ['files.read'] },
  list_folders: { scopes: ['files:read'], permissions: ['files.read'] },
  list_tags: { scopes: ['files:read'], permissions: ['files.read'] },
  list_short_links: { scopes: ['urls:read'], permissions: ['links.read'] },
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
  set_file_sharing: { scopes: ['files:share'], permissions: ['files.share'] },
  delete_files: { scopes: ['files:delete'], permissions: ['files.delete'] },
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
  delete_short_link: { scopes: ['urls:write'], permissions: ['links.delete'] },
}

type Mirror = {
  /** Dashboard actions whose permissions the tool must need. */
  actions?: Action[]
  /** Account routes whose permissions the tool must need. */
  routes?: [method: string, path: string][]
}

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
      },
    },
    search_files: { actions: ['viewFiles'], routes: [['GET', '/api/files']] },
    get_file: { actions: ['viewFiles'], routes: [['GET', '/api/files']] },
    read_file: { actions: ['viewFiles'] },
    list_folders: { actions: ['viewFiles'], routes: [['GET', '/api/folders']] },
    list_tags: { actions: ['viewFiles'], routes: [['GET', '/api/tags']] },
    list_short_links: {
      actions: ['viewLinks'],
      routes: [['GET', '/api/urls']],
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
    set_file_sharing: { actions: ['shareFiles'] },
    delete_files: { actions: ['deleteFiles'] },
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
    delete_short_link: { routes: [['DELETE', '/api/urls/link-id']] },
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
}

describe('the authorization matrix', () => {
  it.each(rows)('%s needs what the approved design says', (name, row) => {
    const design = DESIGN[name]
    expect([...row.scopes]).toEqual(design.scopes)
    expect(sorted(row.permissions)).toEqual(sorted(design.permissions))
    expect(Object.keys(row.effects ?? {}).sort()).toEqual(
      Object.keys(design.effects ?? {}).sort()
    )
    for (const [effect, needs] of Object.entries(design.effects ?? {})) {
      expect([...row.effects![effect].scopes], effect).toEqual(needs.scopes)
      expect(sorted(row.effects![effect].permissions), effect).toEqual(
        sorted(needs.permissions)
      )
    }
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
    }
  )

  it('lists every tool that has a REST route or dashboard action to mirror', () => {
    const unmirrored = TOOL_NAMES.filter(
      (name) => !MIRRORS[name].actions?.length && !MIRRORS[name].routes?.length
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
      'delete_short_link',
    ])
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
      for (const needs of [row, ...Object.values(row.effects ?? {})])
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

  it('never offers a scope that does not exist', () => {
    expect(scopeAvailable('files:everything', () => true, true)).toBe(false)
    expect(scopeAvailable('', () => true, true)).toBe(false)
  })
})
