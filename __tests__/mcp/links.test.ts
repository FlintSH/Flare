import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditContext, auditContext } from '@/lib/audit/context'
import { HttpError } from '@/lib/http/errors'
import type { ShortLink } from '@/lib/links/schema'
import {
  TOOL_CATALOG,
  type ToolName,
  type ToolRow,
  needsMet,
} from '@/lib/mcp/catalog'
import {
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from '@/lib/mcp/tool'
import { linksTools } from '@/lib/mcp/tools/links'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/links/service', () => ({
  listOwnShortLinks: mocks.list,
  createShortLink: mocks.create,
  deleteOwnShortLink: mocks.remove,
}))

const ORIGIN = 'https://flare.test'

/** What a tool is handed for one call, with the catalog's own effect rule. */
function contextFor(
  name: ToolName,
  scopes: readonly string[],
  permissions: readonly Permission[]
): ToolContext {
  const user = {
    id: 'owner',
    storageUsed: 0,
    urlId: 'alex',
    vanityId: null,
    permissions: [...permissions],
    roles: [],
    randomizeFileUrls: false,
    credential: 'token' as const,
  }
  const principal = {
    user,
    name: 'Alex',
    scopes,
    credentialKey: 'token:t1',
    can: (permission: Permission) => hasPermission(user, permission),
  }
  const effect = (effectName: string) => {
    const needs = (TOOL_CATALOG[name] as ToolRow).effects?.[effectName]
    if (!needs) throw new Error(`${name} has no effect called ${effectName}`)
    return needs
  }
  return {
    principal,
    request: new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }),
    origin: ORIGIN,
    allows: (effectName) => needsMet(effect(effectName), principal),
    requireEffect(effectName) {
      if (!needsMet(effect(effectName), principal))
        throw new ToolError(`Not allowed: ${effectName}`, 'denied')
    },
  }
}

/**
 * Calls a tool the way the server does: arguments through its input schema,
 * inside a request's audit context. The answer must be exactly what the
 * output schema describes, with nothing left over.
 */
async function call(name: ToolName, args: unknown) {
  const tool = (linksTools as ToolDefinition[]).find(
    (candidate) => candidate.name === name
  )!
  const audit: AuditContext = {}
  const row: ToolRow = TOOL_CATALOG[name]
  const { structured } = await auditContext.run(audit, () =>
    tool.run(
      tool.input.parse(args) as never,
      contextFor(name, row.scopes, row.permissions)
    )
  )
  expect(tool.output.parse(structured)).toEqual(structured)
  return { structured: structured as Record<string, never>, audit }
}

const link = (index: number, fields: Partial<ShortLink> = {}): ShortLink => ({
  id: `link-${index}`,
  shortCode: `code${String(index).padStart(2, '0')}`,
  targetUrl: `https://example.com/page/${index}`,
  clicks: index,
  createdAt: '2026-09-20T12:00:00.000Z',
  userId: 'owner',
  ...fields,
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('list_short_links', () => {
  it("answers the account's links with the address each one redirects from", async () => {
    mocks.list.mockResolvedValue([
      link(1, { shortCode: 'aB3_dE', targetUrl: 'https://example.com/a' }),
    ])
    const { structured } = await call('list_short_links', {})
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('owner')
    expect(structured).toEqual({
      links: [
        {
          id: 'link-1',
          code: 'aB3_dE',
          short_url: 'https://flare.test/u/aB3_dE',
          target_url: 'https://example.com/a',
          clicks: 1,
          created_at: '2026-09-20T12:00:00.000Z',
        },
      ],
      total: 1,
    })
  })

  it('keeps the links whose code or target contains the query, whatever the letter case', async () => {
    mocks.list.mockResolvedValue([
      link(1, { shortCode: 'DocsAB' }),
      link(2, { targetUrl: 'https://example.com/DOCS/start' }),
      link(3),
    ])
    const { structured } = await call('list_short_links', { query: ' docs ' })
    expect(structured.links).toMatchObject([{ id: 'link-1' }, { id: 'link-2' }])
    expect(structured.total).toBe(2)
  })

  it('answers 20 links a page unless asked, and continues from the cursor', async () => {
    mocks.list.mockResolvedValue(
      Array.from({ length: 45 }, (_, index) => link(index))
    )
    const first = await call('list_short_links', {})
    expect(first.structured.links).toHaveLength(20)
    expect(first.structured.total).toBe(45)
    const second = await call('list_short_links', {
      cursor: first.structured.next_cursor,
    })
    expect(second.structured.links).toMatchObject(
      Array.from({ length: 20 }, (_, index) => ({ id: `link-${index + 20}` }))
    )
    const last = await call('list_short_links', {
      cursor: second.structured.next_cursor,
    })
    expect(last.structured.links).toHaveLength(5)
    expect(last.structured).not.toHaveProperty('next_cursor')

    const wide = await call('list_short_links', { limit: 40 })
    expect(wide.structured.links).toHaveLength(40)
    const rest = await call('list_short_links', {
      limit: 40,
      cursor: wide.structured.next_cursor,
    })
    expect(rest.structured.links).toMatchObject(
      Array.from({ length: 5 }, (_, index) => ({ id: `link-${index + 40}` }))
    )
  })

  it('refuses a cursor it did not give and a limit above 100', async () => {
    await expect(
      call('list_short_links', { cursor: 'not-a-cursor' })
    ).rejects.toThrow(/cursor is not valid/)
    expect(mocks.list).not.toHaveBeenCalled()
    await expect(call('list_short_links', { limit: 101 })).rejects.toThrow()
  })
})

describe('create_short_link', () => {
  it('shortens the URL as the route does and answers the short URL', async () => {
    mocks.create.mockResolvedValue(
      link(7, { shortCode: 'aB3_dE', targetUrl: 'https://example.com/a?b=c' })
    )
    const { structured, audit } = await call('create_short_link', {
      url: 'https://example.com/a?b=c',
    })
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'https://example.com/a?b=c'
    )
    expect(structured.link).toMatchObject({
      id: 'link-7',
      short_url: 'https://flare.test/u/aB3_dE',
      target_url: 'https://example.com/a?b=c',
    })
    expect(audit).toMatchObject({
      targetType: 'link',
      targetId: 'link-7',
      targetName: 'aB3_dE',
    })
  })

  it('refuses what the route refuses, before a link is made', async () => {
    // The server answers a schema refusal with its first issue's message.
    await expect(
      call('create_short_link', { url: 'ftp://example.com/file' })
    ).rejects.toMatchObject({
      name: 'ZodError',
      issues: [{ message: 'Only HTTP and HTTPS URLs are allowed' }],
    })
    await expect(
      call('create_short_link', { url: 'not a url' })
    ).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('delete_short_link', () => {
  const own = [
    link(1, { id: 'cm_first', shortCode: 'aB3_dE' }),
    link(2, { id: 'cm_second', shortCode: 'Zz9-_q' }),
  ]
  beforeEach(() => {
    mocks.list.mockResolvedValue(own)
  })

  it.each([
    ['its ID', 'cm_second'],
    ['its code', 'Zz9-_q'],
    ['its short URL', 'https://flare.test/u/Zz9-_q'],
    ['its short path', '/u/Zz9-_q'],
  ])('deletes the link named by %s', async (_how, value) => {
    const { structured, audit } = await call('delete_short_link', {
      link: value,
    })
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('owner')
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('owner', 'cm_second')
    expect(structured).toEqual({
      id: 'cm_second',
      code: 'Zz9-_q',
      target_url: 'https://example.com/page/2',
    })
    expect(audit).toMatchObject({
      targetType: 'link',
      targetId: 'cm_second',
      targetName: 'Zz9-_q',
    })
  })

  it('answers a code of another account, or of no link, the same way without deleting', async () => {
    for (const value of ['cm_other', 'zz9-_q', 'https://flare.test/u/nope12'])
      await expect(
        call('delete_short_link', { link: value })
      ).rejects.toMatchObject({
        name: 'ToolError',
        message: expect.stringContaining('list_short_links'),
      })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it("passes on the service's own refusal", async () => {
    mocks.remove.mockRejectedValue(new HttpError(404, 'URL not found'))
    await expect(
      call('delete_short_link', { link: 'cm_first' })
    ).rejects.toMatchObject({ status: 404, message: 'URL not found' })
  })
})
