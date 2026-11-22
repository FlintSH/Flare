/**
 * The handbook's MCP pages state what the code decides: which tools exist,
 * what each needs, where each scope works, how each client is set up, and
 * what MCP covers of the HTTP API. These tests read the pages and compare
 * them to the tables the server itself reads, so the handbook cannot drift.
 *
 * A failure lists every row that is missing or wrong, written as the page
 * should have it, ready to paste.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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

const page = (path: string) =>
  readFileSync(resolve(process.cwd(), 'docs/site', path), 'utf8')

const reference = page('api/mcp.md')
const guide = page('guide/agents.md')
const scopes = page('api/authentication.md')

/** The address and token the handbook's examples use. */
const EXAMPLE_URL = 'https://files.example.com/api/mcp'
const EXAMPLE_TOKEN = 'flr_YOUR_TOKEN'

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
  it('names every client that cannot connect yet, in the section that says so', () => {
    const waiting = AGENT_CLIENTS.filter(({ method }) => method === 'sign-in')
    const lines = guide.split('\n')
    const start = lines.findIndex(
      (line) =>
        /^#{2,4} /.test(line) &&
        waiting.every(({ label }) => line.includes(label))
    )
    expect(start, 'a heading that names every such client').toBeGreaterThan(-1)
    const end = lines.findIndex(
      (line, index) => index > start && /^#{1,4} /.test(line)
    )
    expect(lines.slice(start, end).join('\n')).toContain('cannot connect yet')
  })

  it('shows, for every client that connects with a token, exactly what Connect an agent shows', () => {
    const missing: string[] = []
    for (const client of AGENT_CLIENTS) {
      if (client.method !== 'token') continue
      // Each client has its own section.
      if (!new RegExp(`^### ${client.label}\\b`, 'm').test(guide))
        missing.push(`A "### ${client.label}" section`)
      for (const snippet of client.setup(EXAMPLE_URL, EXAMPLE_TOKEN).snippets)
        if (!guide.includes(snippet.code))
          missing.push(`${client.label}, ${snippet.title}:\n${snippet.code}`)
    }
    expect(missing).toEqual([])
  })

  it('never shows a one-click install link, which would carry a token', () => {
    for (const client of AGENT_CLIENTS) {
      if (client.method !== 'token') continue
      for (const link of client.setup(EXAMPLE_URL, EXAMPLE_TOKEN).links) {
        expect(guide).not.toContain(link.href)
        // The button is named, so readers know what to look for.
        expect(guide).toContain(link.label)
      }
    }
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
    for (const [name, text] of Object.entries({ reference, guide, scopes })) {
      const tokens = text.match(/flr_[A-Za-z0-9_-]+/g) ?? []
      expect(
        tokens.filter((token) => token !== EXAMPLE_TOKEN),
        name
      ).toEqual([])
    }
  })
})
