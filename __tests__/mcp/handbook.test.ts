/**
 * The handbook's MCP pages state what the code decides: which tools exist,
 * what each needs, where each scope works, how each client is set up, how an
 * agent signs in, and what MCP covers of the HTTP API. These tests read the
 * pages and compare them to the tables the server itself reads, so the
 * handbook cannot drift.
 *
 * A failure lists every row that is missing or wrong, written as the page
 * should have it, ready to paste.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { API_SCOPE_CATALOG } from '@/lib/integrations/bearer-routes'
import {
  TOOL_CATALOG,
  TOOL_NAMES,
  type ToolAnnotations,
  type ToolNeeds,
  type ToolRow,
  toolAllowed,
} from '@/lib/mcp/catalog'
import { AGENT_CLIENTS, AGENT_PRESETS } from '@/lib/mcp/clients'
import {
  API_COVERAGE,
  type Coverage,
  LATER_AREAS,
  UNEXPOSED_REASONS,
} from '@/lib/mcp/coverage'
import { UPLOAD_HOLD_HOURS } from '@/lib/mcp/transfer'
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_SECONDS,
  CLIENT_ID_PREFIX,
  CODE_SECONDS,
  MAX_AUTHORIZE_QUERY,
  MAX_CLIENT_NAME_LENGTH,
  MAX_CONNECTIONS,
  MAX_REDIRECT_URIS,
  MAX_REDIRECT_URI_LENGTH,
  MAX_STATE_LENGTH,
  MAX_SUCCESSORS,
  MAX_UNUSED_CLIENTS,
  PENDING_SECONDS,
  REFRESH_TOKEN_DAYS,
  REFRESH_TOKEN_PREFIX,
  REGISTRATIONS_PER_HOUR,
  REGISTRATION_BODY_BYTES,
  ROTATION_LEEWAY_SECONDS,
  UNUSED_CLIENT_HOURS,
} from '@/lib/oauth/constants'
import {
  authorizationServerMetadata,
  bearerChallenge,
  protectedResourceMetadata,
} from '@/lib/oauth/urls'

const page = (path: string) =>
  readFileSync(resolve(process.cwd(), 'docs/site', path), 'utf8')

const reference = page('api/mcp.md')
const guide = page('guide/agents.md')
const scopes = page('api/authentication.md')
const administration = page('admin/agents.md')

/** The address and token the handbook's examples use. */
const EXAMPLE_ORIGIN = 'https://files.example.com'
const EXAMPLE_URL = `${EXAMPLE_ORIGIN}/api/mcp`
const EXAMPLE_TOKEN = 'flr_YOUR_TOKEN'
/** What stands for a sign-in's access token, refresh token and client ID. */
const EXAMPLE_SIGN_IN_SECRETS = [
  `${ACCESS_TOKEN_PREFIX}YOUR_ACCESS_TOKEN`,
  `${REFRESH_TOKEN_PREFIX}YOUR_REFRESH_TOKEN`,
  `${CLIENT_ID_PREFIX}YOUR_CLIENT_ID`,
]

/** How the coverage table names each reason; the page explains each once. */
const REASON_LABELS = {
  credentials: 'Never: credentials',
  'sign-in': 'Never: sign-in',
  'full-control': 'Never: full control',
  browser: "Not applicable: Flare's own pages",
  mcp: 'The MCP server itself',
} as const

const code = (value: string) => '`' + value + '`'
const codes = (values: readonly string[], none: string) =>
  values.length ? values.map(code).join(', ') : none
const markdownRow = (cells: readonly string[]) => `| ${cells.join(' | ')} |`

/**
 * The body rows of a section's tables: from the heading with this text to the
 * next heading of the same level or above. Without `all`, only the first
 * table, which is the one the heading introduces. Cells are trimmed, so the
 * padding a formatter adds does not matter.
 */
function tableRows(
  markdown: string,
  heading: string,
  { all = false } = {}
): string[][] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(
    (line) => /^#{2,4} /.test(line) && line.replace(/^#+ /, '') === heading
  )
  if (start < 0) throw new Error(`The page has no "${heading}" heading.`)
  const level = lines[start].indexOf(' ')
  const rows: string[][] = []
  let inTable = false
  for (const line of lines.slice(start + 1)) {
    const next = /^(#{1,6}) /.exec(line)
    if (next && next[1].length <= level) break
    if (!line.startsWith('|')) {
      if (inTable && !all) break
      inTable = false
      continue
    }
    const cells = line
      .slice(1, line.lastIndexOf('|'))
      .split('|')
      .map((cell) => cell.trim())
    // A table's first two lines are its header and the rule under it.
    if (!inTable) inTable = true
    else if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells)
  }
  return rows
}

/** The `code` values a cell names. */
const named = (cell = '') =>
  [...cell.matchAll(/`([^`]+)`/g)].map(([, value]) => value)

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/** A cell with markdown emphasis removed. */
const plain = (cell = '') => cell.replace(/\*\*/g, '')

/**
 * The four annotations as the reference writes them: what the call does to
 * data, then the hints that are on.
 */
function annotationText({
  readOnly,
  destructive,
  idempotent,
  openWorld,
}: ToolAnnotations): string {
  return [
    readOnly ? 'Read-only' : destructive ? 'Destructive' : 'Writes',
    ...(idempotent ? ['idempotent'] : []),
    ...(openWorld ? ['open world'] : []),
  ].join(', ')
}

const scopeLabel = (scope: string) =>
  API_SCOPE_CATALOG.find((entry) => entry.scope === scope)!.label

describe('the MCP reference (docs/site/api/mcp.md)', () => {
  it('lists every tool with its title and annotations, and no tool that does not exist', () => {
    const rows = tableRows(reference, 'Tools')
    const problems: string[] = []
    for (const name of TOOL_NAMES) {
      const { title, annotations }: ToolRow = TOOL_CATALOG[name]
      const row = rows.find(([tool]) => tool === code(name))
      if (
        !row ||
        row[1] !== title ||
        row[2] !== annotationText(annotations) ||
        !row[3]
      )
        problems.push(
          markdownRow([
            code(name),
            title,
            annotationText(annotations),
            row?.[3] || '(what it does)',
          ])
        )
    }
    for (const [tool] of rows)
      if (!TOOL_NAMES.some((name) => code(name) === tool))
        problems.push(`${tool} is listed but is not a tool.`)
    expect(problems).toEqual([])
    // The table is in the order clients list the tools.
    expect(rows.map(([tool]) => tool)).toEqual(TOOL_NAMES.map(code))
  })

  it('states the scopes and role permissions every tool needs', () => {
    const rows = tableRows(reference, 'Authorization matrix')
    const problems: string[] = []
    for (const name of TOOL_NAMES) {
      const needs: ToolNeeds = TOOL_CATALOG[name]
      const row = rows.find(([tool]) => tool === code(name))
      if (
        !row ||
        !sameSet(named(row[1]), needs.scopes) ||
        !sameSet(named(row[2]), needs.permissions)
      )
        problems.push(
          markdownRow([
            code(name),
            codes(needs.scopes, 'Any'),
            codes(needs.permissions, 'None'),
          ])
        )
    }
    expect(rows).toHaveLength(TOOL_NAMES.length)
    expect(problems).toEqual([])
  })

  it('documents every effect an argument can have, with what it needs', () => {
    const rows = tableRows(reference, 'Arguments that need more')
    const problems: string[] = []
    let effects = 0
    for (const name of TOOL_NAMES) {
      const row: ToolRow = TOOL_CATALOG[name]
      for (const [effect, needs] of Object.entries(row.effects ?? {})) {
        effects++
        const found = rows.find(
          (cells) => cells[0] === code(name) && cells[1] === code(effect)
        )
        if (
          !found ||
          !found[2] ||
          !sameSet(named(found[3]), needs.scopes) ||
          !sameSet(named(found[4]), needs.permissions)
        )
          problems.push(
            markdownRow([
              code(name),
              code(effect),
              found?.[2] || '(when it applies)',
              codes(needs.scopes, 'None'),
              codes(needs.permissions, 'None'),
            ])
          )
      }
    }
    expect(rows).toHaveLength(effects)
    expect(problems).toEqual([])
  })

  it('says how many tools each preset lists for a role that allows everything', () => {
    const rows = tableRows(reference, 'Tools by preset')
    const problems: string[] = []
    for (const preset of AGENT_PRESETS) {
      const subject = { scopes: preset.scopes, can: () => true }
      const listed = TOOL_NAMES.filter((name) => toolAllowed(name, subject))
      const row = rows.find(([label]) => plain(label) === preset.label)
      if (
        !row ||
        !sameSet(named(row[1]), preset.scopes) ||
        row[2] !== String(listed.length)
      )
        problems.push(
          markdownRow([
            `**${preset.label}**`,
            codes(preset.scopes, 'None'),
            String(listed.length),
          ])
        )
    }
    expect(rows).toHaveLength(AGENT_PRESETS.length)
    expect(problems).toEqual([])
  })

  describe('the coverage table', () => {
    // Every table in the section; the first explains the markers, so only
    // rows that name a route count.
    const rows = tableRows(reference, 'What MCP covers of the HTTP API', {
      all: true,
    }).filter(([route]) => route.startsWith('`/api/'))

    /**
     * What the third cell of a route's row says. Null for a preflight: those
     * carry no data, and the page says so once for all of them.
     */
    function covered(coverage: Coverage): string | null {
      if ('tools' in coverage) return codes(coverage.tools, '')
      if (coverage.reason === 'later')
        return `Later: ${LATER_AREAS[coverage.area]}`
      if (coverage.reason === 'preflight') return null
      return REASON_LABELS[coverage.reason]
    }

    it('gives every reason a route has no tool, in the words the code uses', () => {
      for (const [reason, sentence] of Object.entries(UNEXPOSED_REASONS)) {
        expect(reference, reason).toContain(sentence)
        if (reason in REASON_LABELS)
          expect(reference, reason).toContain(
            REASON_LABELS[reason as keyof typeof REASON_LABELS]
          )
      }
      for (const area of Object.values(LATER_AREAS))
        expect(reference).toContain(`Later: ${area}`)
    })

    it('has a row for every route and method, with its tools or its reason', () => {
      const problems: string[] = []
      for (const [path, methods] of Object.entries(API_COVERAGE))
        for (const [method, coverage] of Object.entries(methods)) {
          const expected = covered(coverage)
          if (expected === null) continue
          const row = rows.find(
            (cells) =>
              cells[0] === code(path) &&
              cells[1].split(',').some((entry) => entry.trim() === method)
          )
          const matches =
            row &&
            ('tools' in coverage
              ? sameSet(named(row[2]), coverage.tools)
              : row[2] === expected) &&
            (row[3] ?? '') === (coverage.note ?? '')
          if (!matches)
            problems.push(
              markdownRow([code(path), method, expected, coverage.note ?? ''])
            )
        }
      expect(problems).toEqual([])
    })

    it('lists no route or method the API does not have', () => {
      const extra: string[] = []
      for (const [route, methods] of rows)
        for (const method of methods.split(',').map((entry) => entry.trim())) {
          const path = named(route)[0]
          if (!API_COVERAGE[path]?.[method as 'GET'])
            extra.push(`${method} ${path}`)
        }
      expect(extra).toEqual([])
    })
  })
})

describe('agent sign-in in the reference (docs/site/api/mcp.md)', () => {
  // Every address Flare publishes is built from NEXTAUTH_URL; the handbook
  // writes them for the example instance.
  const request = new Request(EXAMPLE_URL)
  beforeAll(() => {
    vi.stubEnv('NEXTAUTH_URL', EXAMPLE_ORIGIN)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  /** A metadata value as its table cell writes it: each string as code. */
  const cell = (value: unknown) =>
    (Array.isArray(value) ? value : [value])
      .map((entry) => code(String(entry)))
      .join(', ')

  /**
   * What a section's field table should hold for a metadata document, as
   * rows that are missing or wrong, and the fields it lists that the
   * document does not have.
   */
  function fieldProblems(heading: string, metadata: Record<string, unknown>) {
    const rows = tableRows(reference, heading)
    const problems = Object.entries(metadata)
      .filter(
        ([field, value]) =>
          rows.find(([name]) => name === code(field))?.[1] !== cell(value)
      )
      .map(([field, value]) => markdownRow([code(field), cell(value)]))
    for (const [name] of rows)
      if (!named(name).some((field) => field in metadata))
        problems.push(`${name} is listed but is not in the document.`)
    return problems
  }

  it('documents every field of the protected resource metadata, with the value Flare answers', () => {
    expect(
      fieldProblems(
        'Protected resource metadata',
        protectedResourceMetadata(request)
      )
    ).toEqual([])
  })

  it('documents every field of the authorization server metadata, with the value Flare answers', () => {
    expect(
      fieldProblems(
        'Authorization server metadata',
        authorizationServerMetadata(request)
      )
    ).toEqual([])
  })

  it('shows the challenge a 401 carries, which is what starts a sign-in', () => {
    expect(reference).toContain(`WWW-Authenticate: ${bearerChallenge(request)}`)
    // The one sent when a token was presented and refused.
    expect(reference).toContain(
      `WWW-Authenticate: ${bearerChallenge(request, true)}`
    )
  })

  it('states how long a started upload holds its URL', () => {
    // Prettier pads table cells, so the row is matched by its words.
    expect(reference).toMatch(
      new RegExp(
        `\\| Upload URL held once its upload starts +\\| ${UPLOAD_HOLD_HOURS} hours, or until the upload publishes a file or fails`
      )
    )
    expect(reference).toContain(
      `Flare holds its URL for up to ${UPLOAD_HOLD_HOURS} hours`
    )
  })

  it('states every lifetime and limit of sign-in as the code holds it', () => {
    const rows = tableRows(reference, 'Sign-in lifetimes and limits')
    const expected: [what: string, value: string][] = [
      ['Authorization code', `${CODE_SECONDS} seconds, single use`],
      ['Access token', `${ACCESS_TOKEN_SECONDS / 3600} hour`],
      [
        'Refresh token',
        `${REFRESH_TOKEN_DAYS} days from when it was issued, replaced on every use`,
      ],
      [
        'Reuse of a rotated refresh token',
        `Within ${ROTATION_LEEWAY_SECONDS} seconds, for at most ${MAX_SUCCESSORS} pairs`,
      ],
      [
        'A request waiting for the person',
        `${PENDING_SECONDS / 60} minutes, across the login page and on the consent screen`,
      ],
      ['Connected agents for each account', String(MAX_CONNECTIONS)],
      [
        'Client registrations',
        // The wider limit for one address alone is ten times the first.
        `${REGISTRATIONS_PER_HOUR} an hour for each client address and redirect host, ${REGISTRATIONS_PER_HOUR * 10} an hour for each address`,
      ],
      ['Registration body', `${REGISTRATION_BODY_BYTES / 1024} KB`],
      [
        'Redirect URIs in a registration',
        `${MAX_REDIRECT_URIS}, of at most ${MAX_REDIRECT_URI_LENGTH} characters each`,
      ],
      ['Client name', `${MAX_CLIENT_NAME_LENGTH} characters`],
      [
        'A registration nobody approved',
        `Removed after ${UNUSED_CLIENT_HOURS} hours, and the oldest beyond ${MAX_UNUSED_CLIENTS}`,
      ],
      [
        'Authorize query',
        `${MAX_AUTHORIZE_QUERY.toLocaleString('en-US')} characters, with ${code('state')} at most ${MAX_STATE_LENGTH}`,
      ],
    ]
    expect(
      expected
        .filter(
          ([what, value]) => rows.find(([name]) => name === what)?.[1] !== value
        )
        .map(markdownRow)
    ).toEqual([])
  })

  it('names the token and client ID prefixes the code uses', () => {
    for (const prefix of [
      ACCESS_TOKEN_PREFIX,
      REFRESH_TOKEN_PREFIX,
      CLIENT_ID_PREFIX,
    ])
      expect(reference).toContain(code(prefix))
  })
})

describe('the scope reference (docs/site/api/authentication.md)', () => {
  const WORKS_WITH = {
    'api,mcp': 'REST API and MCP',
    api: 'REST API',
    mcp: 'MCP',
  } as const

  it('lists every scope with its name in the token form and where it works', () => {
    const rows = tableRows(scopes, 'Scope reference')
    const problems: string[] = []
    for (const { scope, label, surfaces } of API_SCOPE_CATALOG) {
      const worksWith =
        WORKS_WITH[[...surfaces].sort().join(',') as keyof typeof WORKS_WITH]
      const row = rows.find(([cell]) => cell === code(scope))
      if (!row || row[1] !== label || row[2] !== worksWith || !row[3])
        problems.push(
          markdownRow([
            code(scope),
            label,
            worksWith,
            row?.[3] || '(what it allows)',
          ])
        )
    }
    expect(rows).toHaveLength(API_SCOPE_CATALOG.length)
    expect(problems).toEqual([])
  })
})

describe('the agents guide (docs/site/guide/agents.md)', () => {
  /** A client's own section: from its heading to the next heading. */
  function section(label: string): string | undefined {
    const lines = guide.split('\n')
    const start = lines.findIndex((line) =>
      new RegExp(`^### ${label}( clients)?$`).test(line)
    )
    if (start < 0) return undefined
    const end = lines.findIndex(
      (line, index) => index > start && /^#{1,4} /.test(line)
    )
    return lines.slice(start, end < 0 ? undefined : end).join('\n')
  }

  it('has a section for every client the dialog offers, with the snippets its sign-in steps show', () => {
    const missing: string[] = []
    for (const client of AGENT_CLIENTS) {
      const text = section(client.label)
      if (text === undefined) {
        missing.push(`A "### ${client.label}" section`)
        continue
      }
      for (const snippet of client.signIn(EXAMPLE_URL).snippets)
        if (!text.includes(snippet.code))
          missing.push(
            `${client.label}, signing in, ${snippet.title}:\n${snippet.code}`
          )
    }
    expect(missing).toEqual([])
  })

  it('shows, for every client that can take a token, exactly what Use a token instead shows', () => {
    const missing: string[] = []
    for (const client of AGENT_CLIENTS) {
      if (client.method !== 'token') continue
      const text = section(client.label) ?? ''
      for (const snippet of client.setup(EXAMPLE_URL, EXAMPLE_TOKEN).snippets)
        if (!text.includes(snippet.code))
          missing.push(
            `${client.label}, with a token, ${snippet.title}:\n${snippet.code}`
          )
    }
    expect(missing).toEqual([])
  })

  it('says of every client that only signs in that it needs a public HTTPS address', () => {
    const waiting = AGENT_CLIENTS.filter(({ method }) => method === 'sign-in')
    expect(waiting.length).toBeGreaterThan(0)
    for (const client of waiting)
      expect(section(client.label), client.label).toContain(
        'public HTTPS address'
      )
    // Sign-in shipped: no client is waiting for it any more.
    expect(guide).not.toContain('cannot connect yet')
  })

  it('names every one-click install button and prints none of the links', () => {
    for (const client of AGENT_CLIENTS) {
      const links = [
        ...client.signIn(EXAMPLE_URL).links,
        // The link of a token setup carries the token.
        ...(client.method === 'token'
          ? client.setup(EXAMPLE_URL, EXAMPLE_TOKEN).links
          : []),
      ]
      for (const link of links) {
        expect(guide).not.toContain(link.href)
        // The button is named, so readers know what to look for.
        expect(guide).toContain(link.label)
      }
    }
  })

  it('states the waits and limits of sign-in as the code holds them', () => {
    for (const sentence of [
      `A request waits ${PENDING_SECONDS / 60} minutes for you.`,
      `open for more than ${PENDING_SECONDS / 60} minutes`,
      `already has ${MAX_CONNECTIONS} connected agents`,
      `not been used for ${REFRESH_TOKEN_DAYS} days`,
      `within ${UNUSED_CLIENT_HOURS} hours`,
      `register ${REGISTRATIONS_PER_HOUR} times an hour`,
    ])
      expect(guide).toContain(sentence)
    expect(administration).toContain(
      `${MAX_CONNECTIONS} agents signed in at once`
    )
  })

  it('describes every preset as the dialog does, with the actions it includes', () => {
    const rows = tableRows(guide, 'Choose what the agent may do')
    const problems: string[] = []
    for (const preset of AGENT_PRESETS) {
      const labels = preset.scopes.map(scopeLabel)
      const row = rows.find(([label]) => plain(label) === preset.label)
      if (
        !row ||
        row[1] !== preset.description ||
        !sameSet(
          row[2].split(',').map((entry) => entry.trim()),
          labels
        )
      )
        problems.push(
          markdownRow([
            `**${preset.label}**`,
            preset.description,
            labels.join(', '),
          ])
        )
    }
    expect(rows).toHaveLength(AGENT_PRESETS.length)
    expect(problems).toEqual([])
  })
})

describe('placeholders', () => {
  it('uses the example address and token, never a real credential', () => {
    const allowed = [EXAMPLE_TOKEN, ...EXAMPLE_SIGN_IN_SECRETS]
    for (const [name, text] of Object.entries({
      reference,
      guide,
      scopes,
      administration,
    })) {
      // Named tokens, and the access tokens, refresh tokens and client IDs
      // of a sign-in.
      const secrets = text.match(/fl[racf]_[A-Za-z0-9_-]+/g) ?? []
      expect(
        secrets.filter((secret) => !allowed.includes(secret)),
        name
      ).toEqual([])
    }
  })
})
