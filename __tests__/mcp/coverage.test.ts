import { readFileSync, readdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { requiredApiScope } from '@/lib/integrations/bearer-routes'
import { TOOL_CATALOG, TOOL_NAMES, type ToolRow } from '@/lib/mcp/catalog'
import {
  API_COVERAGE,
  type Coverage,
  UNEXPOSED_REASONS,
} from '@/lib/mcp/coverage'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
const repo = process.cwd()

/** The methods a route file exports, in any of the forms the routes use. */
function exportedMethods(source: string): string[] {
  const methods = new Set<string>()
  // export const GET = ..., export async function POST(...)
  for (const [, method] of source.matchAll(
    /export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
  ))
    methods.add(method)
  // export { serve as GET, POST }
  for (const [, names] of source.matchAll(/export\s*\{([^}]*)\}/g))
    for (const name of names.split(',')) {
      const exported = name
        .trim()
        .split(/\s+as\s+/)
        .pop()!
      if (METHODS.includes(exported)) methods.add(exported)
    }
  return [...methods]
}

/** Every `METHOD /api/path` the route files on disk answer. */
function operationsOnDisk(): string[] {
  const app = resolve(repo, 'app')
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : [join(directory, entry.name)]
    )
  return walk(join(app, 'api'))
    .filter((file) => file.endsWith('/route.ts'))
    .flatMap((file) => {
      // The endpoint inventory's spelling: `[id]` and `[...path]` as `{id}`.
      const path =
        '/' +
        relative(app, file)
          .replace(/\/route\.ts$/, '')
          .replace(/\[(?:\.{3})?([^\]]+)\]/g, '{$1}')
      const methods = exportedMethods(readFileSync(file, 'utf8'))
      // A route file that answers nothing would be a parsing miss.
      if (!methods.length) throw new Error(`No methods found in ${file}`)
      return methods.map((method) => `${method} ${path}`)
    })
}

const entries = Object.entries(API_COVERAGE).flatMap(([path, methods]) =>
  Object.entries(methods).map(
    ([method, coverage]) => [`${method} ${path}`, coverage] as const
  )
)
const tableOperations: string[] = entries.map(([operation]) => operation)
const toolsOf = (coverage: Coverage) =>
  'tools' in coverage ? coverage.tools : []

describe('reading the route files', () => {
  it('finds methods in every form a route exports them', () => {
    expect(
      exportedMethods(`
        export const GET = api(async () => ({}))
        export async function POST(request: Request) {}
        export function PUT() {}
        export { serve as PATCH, serve as DELETE }
        export const OPTIONS = preflight('token')
        export const dynamic = 'force-dynamic'
        const HEAD = 1
      `).sort()
    ).toEqual(['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'])
  })

  it('reads the MCP route, which exports one handler under three names', () => {
    expect(operationsOnDisk()).toEqual(
      expect.arrayContaining([
        'GET /api/mcp',
        'POST /api/mcp',
        'DELETE /api/mcp',
        'OPTIONS /api/mcp',
      ])
    )
  })
})

describe('the coverage contract', () => {
  const disk = operationsOnDisk()

  it('maps every API route and method to a tool or a reason', () => {
    const missing = disk.filter(
      (operation) => !tableOperations.includes(operation)
    )
    expect(
      missing,
      'Add these to lib/mcp/coverage.ts with the tool that covers them or the reason none does'
    ).toEqual([])
  })

  it('names no route or method that does not exist', () => {
    const gone = tableOperations.filter(
      (operation) => !disk.includes(operation)
    )
    expect(gone, 'Remove these from lib/mcp/coverage.ts').toEqual([])
  })

  it('lists each route and method once', () => {
    expect(new Set(tableOperations).size).toBe(tableOperations.length)
    expect(tableOperations.length).toBe(disk.length)
  })

  it('names only tools that are in the catalog', () => {
    const unknown = entries.flatMap(([operation, coverage]) =>
      toolsOf(coverage)
        .filter((tool) => !Object.hasOwn(TOOL_CATALOG, tool))
        .map((tool) => `${operation}: ${tool}`)
    )
    expect(unknown).toEqual([])
  })

  it('names every tool somewhere, so the handbook can say what each replaces', () => {
    const named = new Set(entries.flatMap(([, coverage]) => toolsOf(coverage)))
    expect(TOOL_NAMES.filter((name) => !named.has(name))).toEqual([])
  })

  it.each(entries)(
    '%s is covered by tools or has one known reason',
    (operation, coverage) => {
      if ('tools' in coverage) {
        expect(coverage).not.toHaveProperty('reason')
        expect(coverage.tools.length).toBeGreaterThan(0)
        expect(new Set(coverage.tools).size).toBe(coverage.tools.length)
      } else {
        expect(Object.keys(UNEXPOSED_REASONS)).toContain(coverage.reason)
        expect(coverage).not.toHaveProperty('area')
      }
      // A preflight is the only thing OPTIONS answers, and only OPTIONS does.
      expect('reason' in coverage && coverage.reason === 'preflight').toBe(
        operation.startsWith('OPTIONS ')
      )
      if (coverage.note !== undefined) {
        expect(coverage.note).toMatch(/^[A-Za-z].*\.$/)
        expect(coverage.note).not.toMatch(/[\u2013\u2014]/)
      }
    }
  )

  it('gives each reason one plain sentence', () => {
    expect(Object.keys(UNEXPOSED_REASONS)).toEqual([
      'credentials',
      'sign-in',
      'full-control',
      'mail-delivery',
      'logos',
      'browser',
      'preflight',
      'mcp',
    ])
    for (const sentence of Object.values(UNEXPOSED_REASONS)) {
      expect(sentence).toMatch(/^[A-Z]/)
      expect(sentence).not.toMatch(/[\u2013\u2014]/)
    }
    for (const sentence of Object.values(UNEXPOSED_REASONS)) {
      expect(sentence.endsWith('.')).toBe(true)
      expect(sentence.slice(0, -1)).not.toMatch(/[.!?]\s/)
    }
  })

  it('uses every reason it defines', () => {
    const reasons = new Set<string>()
    for (const [, coverage] of entries)
      if ('reason' in coverage) reasons.add(coverage.reason)
    expect([...reasons].sort()).toEqual(Object.keys(UNEXPOSED_REASONS).sort())
  })

  it('leaves nothing for a later change', () => {
    expect(UNEXPOSED_REASONS).not.toHaveProperty('later')
    expect(
      entries
        .filter(([, coverage]) => 'reason' in coverage)
        .map(([, coverage]) => coverage)
    ).not.toContainEqual(expect.objectContaining({ reason: 'later' }))
  })
})

describe('archives and account settings', () => {
  const table = new Map<string, Coverage>(entries)

  it.each<[string, string[]]>([
    ['POST /api/files/archive', ['create_archive']],
    ['GET /api/files/{id}/archive', ['read_file']],
    ['GET /api/files/{id}/archive/entry', ['read_file']],
    ['POST /api/files/{id}/archive/extract', ['extract_archive']],
    ['PUT /api/profile', ['update_profile']],
    ['POST /api/profile/avatar', ['update_profile']],
    ['GET /api/profile/embed', ['get_account']],
    ['PATCH /api/profile/embed', ['update_profile']],
    ['GET /api/customization/preferences', ['get_account']],
    ['PATCH /api/customization/preferences', ['update_profile']],
    ['GET /api/profile/export', ['export_account']],
    ['GET /api/upload-profiles', ['get_account']],
    ['POST /api/upload-profiles', ['save_upload_profile']],
    ['PUT /api/upload-profiles/default', ['save_upload_profile']],
    ['PUT /api/upload-profiles/{id}', ['save_upload_profile']],
    ['DELETE /api/upload-profiles/{id}', ['delete_upload_profile']],
    ['GET /api/upload-profiles/{id}/export', ['get_account']],
  ])('%s is covered by %j', (operation, covering) => {
    expect(toolsOf(table.get(operation)!)).toEqual(covering)
  })

  it.each([
    // How the owner would lose the account, or see who else is signed in.
    ['DELETE /api/profile', 'sign-in'],
    ['GET /api/profile/sessions', 'sign-in'],
    ['DELETE /api/profile/sessions', 'sign-in'],
    ['DELETE /api/profile/sessions/{id}', 'sign-in'],
    ['GET /api/profile/login-history', 'sign-in'],
    // Visitors of a shared archive, and the export page's own progress.
    ['POST /api/files/{id}/archive/share', 'browser'],
    ['GET /api/files/{id}/archive/share/entry', 'browser'],
    ['POST /api/files/{id}/archive/share/entry', 'browser'],
    ['GET /api/profile/export/progress', 'browser'],
  ])('%s stays without a tool: %s', (operation, reason) => {
    expect(table.get(operation)).toEqual({ reason })
  })

  it('says where a tool does less than its route', () => {
    const note = (operation: string) => table.get(operation)?.note ?? ''
    // No tool changes how the account signs in.
    expect(note('PUT /api/profile')).toMatch(
      /the email address and the password change only in the browser/
    )
    expect(note('POST /api/profile/avatar')).toMatch(
      /already in the library.*no upload of its own/
    )
    // The settings themselves are read in full, by get_account.
    for (const read of [
      'GET /api/profile/embed',
      'GET /api/customization/preferences',
    ])
      expect(table.get(read)).toEqual({ tools: ['get_account'] })
    expect(note('POST /api/upload-profiles')).toMatch(
      /does not import a recipe file/
    )
    expect(note('GET /api/upload-profiles/{id}/export')).toMatch(
      /no tool makes the recipe file/
    )
  })
})

describe('invites, administration and moderation', () => {
  const table = new Map<string, Coverage>(entries)

  it.each<[string, string[]]>([
    ['GET /api/invites', ['list_invites']],
    ['POST /api/invites', ['create_invite']],
    ['DELETE /api/invites/{id}', ['revoke_invite']],
    ['GET /api/users', ['list_users']],
    ['POST /api/users', ['create_user']],
    ['PUT /api/users', ['update_user']],
    ['DELETE /api/users/{id}', ['delete_user']],
    ['POST /api/users/{id}/login', ['get_user']],
    ['DELETE /api/users/{id}/avatar', ['update_user']],
    ['DELETE /api/users/{id}/sessions', ['update_user']],
    ['GET /api/users/{id}/email', ['get_user']],
    ['POST /api/users/{id}/email', ['update_user']],
    ['GET /api/roles', ['list_roles']],
    ['POST /api/roles', ['save_role']],
    ['PATCH /api/roles/{id}', ['save_role']],
    ['DELETE /api/roles/{id}', ['delete_role']],
    ['GET /api/audit', ['search_audit_log']],
    ['GET /api/settings', ['get_instance_settings']],
    ['PATCH /api/settings', ['update_instance_settings']],
    ['GET /api/settings/invites', ['get_instance_settings']],
    ['PUT /api/settings/invites', ['update_instance_settings']],
    ['GET /api/settings/email', ['get_instance_settings']],
    ['PUT /api/settings/email', ['update_email_settings']],
    ['GET /api/settings/email/impact', ['get_instance_settings']],
    ['POST /api/settings/email/impact', ['update_email_settings']],
    ['POST /api/settings/email/test', ['send_test_email']],
    ['GET /api/updates/check', ['get_instance_settings']],
    ['GET /api/customization', ['get_instance_settings']],
    ['POST /api/customization', ['update_instance_appearance']],
    // Moderation: the account's own tools, given another account.
    ['GET /api/users/{id}/files', ['search_files']],
    ['PATCH /api/users/{id}/files/{fileId}', ['set_file_sharing']],
    ['DELETE /api/users/{id}/files/{fileId}', ['delete_files']],
    ['GET /api/users/{id}/urls', ['list_short_links']],
    ['DELETE /api/users/{id}/urls/{urlId}', ['delete_short_link']],
  ])('%s is covered by %j', (operation, covering) => {
    expect(toolsOf(table.get(operation)!)).toEqual(covering)
  })

  it.each([
    // The legacy write replaces every setting at once.
    ['POST /api/settings', 'full-control'],
    ['POST /api/settings/email/retry', 'mail-delivery'],
    ['POST /api/customization/assets', 'logos'],
    ['POST /api/settings/favicon', 'logos'],
    ['DELETE /api/settings/favicon', 'logos'],
  ])('%s stays without a tool: %s', (operation, reason) => {
    expect(table.get(operation)).toEqual({ reason })
  })

  it('says the moderation routes take a tool with `account`', () => {
    for (const operation of [
      'GET /api/users/{id}/files',
      'PATCH /api/users/{id}/files/{fileId}',
      'DELETE /api/users/{id}/files/{fileId}',
      'GET /api/users/{id}/urls',
      'DELETE /api/users/{id}/urls/{urlId}',
    ])
      expect(table.get(operation)?.note, operation).toMatch(/with `account`/i)
  })

  it('says where a tool does less than its route', () => {
    const note = (operation: string) => table.get(operation)?.note ?? ''
    // Nothing an agent does sets how anyone signs in.
    expect(note('POST /api/users')).toMatch(/no password/)
    expect(note('PUT /api/users')).toMatch(
      /does not change the email address or the password/
    )
    expect(note('PUT /api/settings/email')).toMatch(
      /does not change the SMTP connection/
    )
    // No call grants a key permission or acts on the acting account.
    for (const operation of [
      'GET /api/invites',
      'POST /api/invites',
      'POST /api/users',
      'PUT /api/users',
      'POST /api/users/{id}/email',
      'POST /api/roles',
      'PATCH /api/roles/{id}',
      'PUT /api/settings/invites',
    ])
      expect(note(operation), operation).toMatch(/key permission/)
    expect(note('DELETE /api/users/{id}')).toMatch(/this connection acts as/)
    expect(note('DELETE /api/users/{id}/sessions')).toMatch(
      /this connection acts as/
    )
    // Secrets and visitors' code are never read or written.
    expect(note('GET /api/settings')).toMatch(/whether one is saved/)
    expect(note('PATCH /api/settings')).toMatch(/both S3 keys/)
    expect(note('POST /api/settings/email/test')).toMatch(/saved settings only/)
    expect(note('POST /api/customization')).toMatch(
      /no appearance pack and takes no logo/
    )
  })
})

describe('compatibility with the REST API', () => {
  /** A path a named token could call, for a table path. */
  const example = (path: string) => path.replace(/\{[^}]+\}/g, '1')

  it('covers with a tool everything a named token can do over REST', () => {
    const uncovered = entries
      .filter(([operation, coverage]) => {
        const [method, path] = operation.split(' ')
        return requiredApiScope(method, example(path)) && !('tools' in coverage)
      })
      .map(([operation]) => operation)
    expect(uncovered).toEqual([])
  })

  it('lets the scope that works over REST do the same through MCP', () => {
    const widened = entries.flatMap(([operation, coverage]) => {
      const [method, path] = operation.split(' ')
      const restScope = requiredApiScope(method, example(path))
      if (!restScope) return []
      // At least one covering tool asks for nothing but the REST scope.
      const sameScope = toolsOf(coverage).some((tool) => {
        const row: ToolRow = TOOL_CATALOG[tool]
        return row.scopes.every((scope) => scope === restScope)
      })
      return sameScope ? [] : [`${operation} (${restScope})`]
    })
    expect(widened).toEqual([])
  })

  it('finds the named-token operations it checks', () => {
    // Guards the two tests above against a path spelling that matches nothing.
    const operations = entries.filter(([operation]) => {
      const [method, path] = operation.split(' ')
      return requiredApiScope(method, example(path)) !== null
    })
    expect(operations).toHaveLength(13)
  })
})

describe('the module', () => {
  const source = readFileSync(resolve(repo, 'lib/mcp/coverage.ts'), 'utf8')

  it('imports only types, so the handbook check can load it alone', () => {
    const imports = [...source.matchAll(/^import\s.*$/gm)].map(([line]) => line)
    expect(imports).toEqual(["import type { ToolName } from './catalog'"])
    expect(source).not.toMatch(/\brequire\(|\bimport\(/)
  })

  it('loads the way the handbook check loads modules, and reads the same table', async () => {
    const loaded = await import(
      /* @vite-ignore */
      `data:text/javascript;base64,${Buffer.from(
        stripTypeScriptTypes(source)
      ).toString('base64')}`
    )
    expect(loaded.API_COVERAGE).toEqual(API_COVERAGE)
    expect(loaded.UNEXPOSED_REASONS).toEqual(UNEXPOSED_REASONS)
  })

  it('has no em dash', () => {
    expect(source).not.toMatch(/[\u2013\u2014]/)
  })
})
