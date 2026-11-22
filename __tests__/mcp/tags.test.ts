import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditContext, auditContext } from '@/lib/audit/context'
import { HttpError } from '@/lib/http/errors'
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
import { tagsTools } from '@/lib/mcp/tools/tags'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import type { TagView } from '@/lib/tags/schema'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  apply: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/files/delivery', () => ({ findFile: vi.fn() }))
vi.mock('@/lib/folders/service', () => ({ listFolders: vi.fn() }))
vi.mock('@/lib/tags/manage', () => ({
  listTags: mocks.list,
  createTag: mocks.create,
  updateTag: mocks.update,
  deleteTag: mocks.remove,
}))
vi.mock('@/lib/tags/service', () => ({
  applyTagToExistingFiles: mocks.apply,
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
    moderating: null,
    mayModerate: false,
    requireModeration: () => {},
    allows: (effectName) => needsMet(effect(effectName), principal),
    recheck: async () => {},
    requireEffect(effectName) {
      if (!needsMet(effect(effectName), principal))
        throw new ToolError(`Not allowed: ${effectName}`, 'denied')
    },
  }
}

const tool = (name: ToolName) =>
  (tagsTools as ToolDefinition[]).find((candidate) => candidate.name === name)!

/** What the tool's row asks for: enough to call it, and no more. */
const rowNeeds = (name: ToolName): Permission[] => [
  ...(TOOL_CATALOG[name] as ToolRow).permissions,
]

/**
 * Calls a tool the way the server does: arguments through its input schema,
 * inside a request's audit context. The answer must be exactly what the
 * output schema describes, with nothing left over.
 */
async function call(
  name: ToolName,
  args: unknown,
  permissions: readonly Permission[] = rowNeeds(name)
) {
  const audit: AuditContext = {}
  const row: ToolRow = TOOL_CATALOG[name]
  const { structured } = await auditContext.run(audit, () =>
    tool(name).run(
      tool(name).input.parse(args) as never,
      contextFor(name, row.scopes, permissions)
    )
  )
  expect(tool(name).output.parse(structured)).toEqual(structured)
  return { structured: structured as Record<string, never>, audit }
}

const work: TagView = {
  id: 't-work',
  name: 'Work',
  ruleSource: 'filename',
  ruleText: 'invoice',
  fileCount: 3,
}
const plain: TagView = {
  id: 't-plain',
  name: 'Keep',
  ruleSource: null,
  ruleText: null,
  fileCount: 1,
}

const conflict = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })

/** The service answers what it was asked to save. */
const saved =
  (base: TagView) =>
  async (_userId: string, ...rest: unknown[]): Promise<TagView> => ({
    ...base,
    ...(rest.at(-1) as Partial<TagView>),
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue([plain, work])
  mocks.create.mockImplementation(
    saved({ ...plain, id: 't-new', fileCount: 0 })
  )
  mocks.update.mockImplementation(async (_userId, id: string, input) => ({
    ...(id === work.id ? work : plain),
    ...input,
  }))
})

describe('list_tags', () => {
  it('answers each tag with its file count and its rule', async () => {
    const { structured } = await call('list_tags', {})
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('owner')
    expect(structured).toEqual({
      tags: [
        { id: 't-plain', name: 'Keep', file_count: 1 },
        {
          id: 't-work',
          name: 'Work',
          file_count: 3,
          rule_source: 'filename',
          rule_text: 'invoice',
        },
      ],
      total: 2,
    })
  })

  it('answers 200 tags a page and continues from the cursor', async () => {
    mocks.list.mockResolvedValue(
      Array.from({ length: 201 }, (_, index) => ({
        ...plain,
        id: `t-${index}`,
        name: `Tag ${index}`,
      }))
    )
    const first = await call('list_tags', {})
    expect(first.structured.tags).toHaveLength(200)
    expect(first.structured.total).toBe(201)
    const last = await call('list_tags', {
      cursor: first.structured.next_cursor,
    })
    expect(last.structured.tags).toMatchObject([{ id: 't-200' }])
    expect(last.structured).not.toHaveProperty('next_cursor')
  })

  it('refuses a cursor it did not give', async () => {
    await expect(call('list_tags', { cursor: '!!' })).rejects.toThrow(
      /cursor is not valid/
    )
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe('save_tag', () => {
  it('creates a tag with the body the route would read', async () => {
    const { structured, audit } = await call('save_tag', {
      name: '  Tax   2026 ',
    })
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
      name: 'Tax 2026',
      ruleSource: null,
      ruleText: null,
    })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(structured).toEqual({
      tag: { id: 't-new', name: 'Tax 2026', file_count: 0 },
    })
    expect(audit).toMatchObject({
      targetType: 'tag',
      targetId: 't-new',
      targetName: 'Tax 2026',
    })
  })

  it('creates a tag with a rule', async () => {
    const { structured } = await call('save_tag', {
      name: 'Receipts',
      rule_source: 'ocr',
      rule_text: ' Total due ',
    })
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
      name: 'Receipts',
      ruleSource: 'ocr',
      ruleText: 'Total due',
    })
    expect(structured.tag).toMatchObject({
      rule_source: 'ocr',
      rule_text: 'Total due',
    })
  })

  it('needs a name for a new tag', async () => {
    await expect(
      call('save_tag', { rule_source: 'ocr', rule_text: 'x' })
    ).rejects.toBeInstanceOf(ToolError)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([
    ['its ID', 't-work'],
    ['its name', 'Work'],
    ['its name in another letter case', ' work '],
  ])('renames the tag named by %s and keeps its rule', async (_how, tag) => {
    const { structured, audit } = await call('save_tag', { tag, name: 'Job' })
    // The route replaces name and rule together, so the rule is sent again.
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 't-work', {
      name: 'Job',
      ruleSource: 'filename',
      ruleText: 'invoice',
    })
    expect(structured).toEqual({
      tag: {
        id: 't-work',
        name: 'Job',
        file_count: 3,
        rule_source: 'filename',
        rule_text: 'invoice',
      },
    })
    expect(audit).toMatchObject({ targetType: 'tag', targetId: 't-work' })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('sets a rule and keeps the name', async () => {
    await call('save_tag', {
      tag: 'Keep',
      rule_source: 'filename',
      rule_text: 'keep',
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 't-plain', {
      name: 'Keep',
      ruleSource: 'filename',
      ruleText: 'keep',
    })
  })

  it('changes one half of a rule and keeps the other', async () => {
    await call('save_tag', { tag: 'Work', rule_text: 'receipt' })
    expect(mocks.update).toHaveBeenLastCalledWith('owner', 't-work', {
      name: 'Work',
      ruleSource: 'filename',
      ruleText: 'receipt',
    })
    await call('save_tag', { tag: 'Work', rule_source: 'ocr' })
    expect(mocks.update).toHaveBeenLastCalledWith('owner', 't-work', {
      name: 'Work',
      ruleSource: 'ocr',
      ruleText: 'invoice',
    })
  })

  it('clears the rule with a null source', async () => {
    const { structured } = await call('save_tag', {
      tag: 'Work',
      rule_source: null,
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 't-work', {
      name: 'Work',
      ruleSource: null,
      ruleText: null,
    })
    expect(structured.tag).toEqual({
      id: 't-work',
      name: 'Work',
      file_count: 3,
    })
  })

  it("refuses half a rule in the route's words, before saving", async () => {
    const message = 'Choose a source and enter text for the automatic tag rule.'
    for (const args of [
      { tag: 'Keep', rule_source: 'ocr' },
      { tag: 'Keep', rule_text: 'keep' },
      { name: 'New', rule_text: 'keep' },
      { tag: 'Work', rule_source: null, rule_text: 'invoice' },
    ])
      await expect(call('save_tag', args)).rejects.toMatchObject({
        name: 'ZodError',
        issues: [{ message }],
      })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a call that changes nothing, and a tag that does not exist', async () => {
    await expect(call('save_tag', { tag: 'Work' })).rejects.toThrow(
      /Nothing to change/
    )
    await expect(
      call('save_tag', { tag: 'Missing', name: 'Found' })
    ).rejects.toThrow(/list_tags/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('words a taken name as the tag routes do', async () => {
    mocks.create.mockRejectedValue(conflict())
    await expect(call('save_tag', { name: 'Work' })).rejects.toMatchObject({
      status: 409,
      message: 'You already have a tag with that name.',
    })
    mocks.update.mockRejectedValue(conflict())
    await expect(
      call('save_tag', { tag: 'Keep', name: 'Work' })
    ).rejects.toMatchObject({ status: 409 })
  })

  describe('apply_rule_to_existing_files', () => {
    const applyTagRule: Permission[] = ['tags.manage', 'files.update']

    it('is refused without the permissions of applying a rule, and nothing is saved', async () => {
      // The row's own permission, tags.manage, is not enough: the apply
      // route also needs files.update.
      expect(rowNeeds('save_tag')).toEqual(['tags.manage'])
      for (const args of [
        { tag: 'Work', apply_rule_to_existing_files: true },
        {
          tag: 'Work',
          rule_text: 'receipt',
          apply_rule_to_existing_files: true,
        },
        {
          name: 'New',
          rule_source: 'filename',
          rule_text: 'new',
          apply_rule_to_existing_files: true,
        },
      ])
        await expect(call('save_tag', args)).rejects.toMatchObject({
          name: 'ToolError',
          outcome: 'denied',
        })
      await expect(
        call('save_tag', { tag: 'Work', apply_rule_to_existing_files: true }, [
          'files.update',
        ])
      ).rejects.toMatchObject({ outcome: 'denied' })
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.apply).not.toHaveBeenCalled()
    })

    it('is left alone when false, whatever the role', async () => {
      await call('save_tag', {
        tag: 'Work',
        name: 'Job',
        apply_rule_to_existing_files: false,
      })
      expect(mocks.update).toHaveBeenCalledOnce()
      expect(mocks.apply).not.toHaveBeenCalled()
    })

    it('saves the rule, then applies it and counts the files it tagged', async () => {
      mocks.apply.mockResolvedValue(4)
      const { structured } = await call(
        'save_tag',
        {
          tag: 'Work',
          rule_text: 'receipt',
          apply_rule_to_existing_files: true,
        },
        applyTagRule
      )
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 't-work', {
        name: 'Work',
        ruleSource: 'filename',
        ruleText: 'receipt',
      })
      expect(mocks.apply).toHaveBeenCalledExactlyOnceWith('owner', 't-work')
      expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.apply.mock.invocationCallOrder[0]
      )
      expect(structured).toEqual({
        tag: {
          id: 't-work',
          name: 'Work',
          file_count: 7,
          rule_source: 'filename',
          rule_text: 'receipt',
        },
        files_tagged: 4,
      })
    })

    it('applies the rule a new tag is created with', async () => {
      mocks.apply.mockResolvedValue(2)
      const { structured } = await call(
        'save_tag',
        {
          name: 'Receipts',
          rule_source: 'ocr',
          rule_text: 'total',
          apply_rule_to_existing_files: true,
        },
        applyTagRule
      )
      expect(mocks.apply).toHaveBeenCalledExactlyOnceWith('owner', 't-new')
      expect(structured).toMatchObject({
        tag: { id: 't-new', file_count: 2 },
        files_tagged: 2,
      })
    })

    it('applies a rule the tag already has without saving the tag again', async () => {
      mocks.apply.mockResolvedValue(0)
      const { structured } = await call(
        'save_tag',
        { tag: 't-work', apply_rule_to_existing_files: true },
        applyTagRule
      )
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.apply).toHaveBeenCalledExactlyOnceWith('owner', 't-work')
      expect(structured).toMatchObject({
        tag: { id: 't-work', file_count: 3 },
        files_tagged: 0,
      })
    })

    it('refuses to apply a rule the tag would not have, before saving', async () => {
      for (const args of [
        { tag: 'Keep', apply_rule_to_existing_files: true },
        { tag: 'Work', rule_source: null, apply_rule_to_existing_files: true },
        { name: 'New', apply_rule_to_existing_files: true },
      ])
        await expect(call('save_tag', args, applyTagRule)).rejects.toThrow(
          /no rule to apply/
        )
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.apply).not.toHaveBeenCalled()
    })
  })
})

describe('delete_tag', () => {
  it.each([
    ['its ID', 't-work'],
    ['its name', 'WORK'],
  ])('deletes the tag named by %s', async (_how, tag) => {
    const { structured, audit } = await call('delete_tag', { tag })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('owner', 't-work')
    expect(structured).toEqual({
      id: 't-work',
      name: 'Work',
      files_untagged: 3,
    })
    expect(audit).toMatchObject({
      targetType: 'tag',
      targetId: 't-work',
      targetName: 'Work',
    })
  })

  it('refuses a tag that does not exist without calling the service', async () => {
    await expect(call('delete_tag', { tag: 'Missing' })).rejects.toThrow(
      /list_tags/
    )
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it("passes on the service's own refusal", async () => {
    mocks.remove.mockRejectedValue(new HttpError(404, 'Tag not found.'))
    await expect(call('delete_tag', { tag: 'Work' })).rejects.toMatchObject({
      status: 404,
      message: 'Tag not found.',
    })
  })

  it('says in its description that the files are kept', () => {
    expect(tool('delete_tag').description).toMatch(/files are kept/)
  })
})
