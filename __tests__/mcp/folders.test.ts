import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditContext, auditContext } from '@/lib/audit/context'
import type { FolderView } from '@/lib/folders/schema'
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
import { foldersTools } from '@/lib/mcp/tools/folders'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/files/delivery', () => ({ findFile: vi.fn() }))
vi.mock('@/lib/tags/manage', () => ({ listTags: vi.fn() }))
vi.mock('@/lib/folders/service', () => ({
  listFolders: mocks.list,
  createFolder: mocks.create,
  updateFolder: mocks.update,
  deleteFolder: mocks.remove,
}))

const ORIGIN = 'https://flare.test'
const TOKEN = 'k3J9vQ2mXz7Lr0TtYb5Nw8Hc1Df4Gs6PaEeUuIiOoSs'

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
    recheck: async () => {},
    requireEffect(effectName) {
      if (!needsMet(effect(effectName), principal))
        throw new ToolError(`Not allowed: ${effectName}`, 'denied')
    },
  }
}

const tool = (name: ToolName) =>
  (foldersTools as ToolDefinition[]).find(
    (candidate) => candidate.name === name
  )!

/**
 * Calls a tool the way the server does: arguments through its input schema,
 * inside a request's audit context. The answer must be exactly what the
 * output schema describes, with nothing left over.
 */
async function call(name: ToolName, args: unknown) {
  const audit: AuditContext = {}
  const row: ToolRow = TOOL_CATALOG[name]
  const { structured } = await auditContext.run(audit, () =>
    tool(name).run(
      tool(name).input.parse(args) as never,
      contextFor(name, row.scopes, row.permissions)
    )
  )
  expect(tool(name).output.parse(structured)).toEqual(structured)
  return { structured: structured as Record<string, never>, audit }
}

const folder = (
  id: string,
  name: string,
  parentId: string | null = null,
  fields: Partial<FolderView> = {}
): FolderView => ({
  id,
  name,
  parentId,
  fileCount: 0,
  shareToken: null,
  ...fields,
})

/** Work/Reports and Personal/Reports share a name; Work/Reports is shared. */
const tree = [
  folder('f-work', 'Work', null, { fileCount: 3 }),
  folder('f-reports', 'Reports', 'f-work', {
    fileCount: 12,
    shareToken: TOKEN,
  }),
  folder('f-personal', 'Personal'),
  folder('f-other-reports', 'Reports', 'f-personal'),
  folder('f-taxes', 'Taxes', 'f-personal'),
]

const conflict = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Database error', {
    code,
    clientVersion: 'test',
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue(tree)
})

describe('list_folders', () => {
  it('answers each folder with its full path, file count and public link', async () => {
    const { structured } = await call('list_folders', {})
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('owner')
    expect(structured).toEqual({
      folders: [
        { id: 'f-personal', path: 'Personal', name: 'Personal', file_count: 0 },
        {
          id: 'f-other-reports',
          path: 'Personal/Reports',
          name: 'Reports',
          file_count: 0,
        },
        {
          id: 'f-taxes',
          path: 'Personal/Taxes',
          name: 'Taxes',
          file_count: 0,
        },
        { id: 'f-work', path: 'Work', name: 'Work', file_count: 3 },
        {
          id: 'f-reports',
          path: 'Work/Reports',
          name: 'Reports',
          file_count: 12,
          share_url: `https://flare.test/s/folders/${TOKEN}`,
        },
      ],
      total: 5,
    })
  })

  it('answers 200 folders a page and continues from the cursor', async () => {
    mocks.list.mockResolvedValue(
      Array.from({ length: 450 }, (_, index) =>
        folder(`f-${index}`, `Folder ${String(index).padStart(3, '0')}`)
      )
    )
    const first = await call('list_folders', {})
    expect(first.structured.folders).toHaveLength(200)
    expect(first.structured.total).toBe(450)
    const second = await call('list_folders', {
      cursor: first.structured.next_cursor,
    })
    expect(second.structured.folders).toHaveLength(200)
    expect(second.structured.folders[0]).toMatchObject({ id: 'f-200' })
    const last = await call('list_folders', {
      cursor: second.structured.next_cursor,
    })
    expect(last.structured.folders).toHaveLength(50)
    expect(last.structured.folders[49]).toMatchObject({ id: 'f-449' })
    expect(last.structured).not.toHaveProperty('next_cursor')
  })

  it('refuses a cursor it did not give', async () => {
    await expect(
      call('list_folders', { cursor: 'bm90LWpzb24' })
    ).rejects.toThrow(/cursor is not valid/)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe('save_folder', () => {
  it('creates a top-level folder with the body the route would read', async () => {
    mocks.create.mockResolvedValue(folder('f-new', 'Tax 2026'))
    const { structured, audit } = await call('save_folder', {
      name: '  Tax   2026 ',
    })
    // The route's schema trims and collapses spaces before the service runs.
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
      name: 'Tax 2026',
      parentId: null,
    })
    expect(structured).toEqual({
      folder: {
        id: 'f-new',
        path: 'Tax 2026',
        name: 'Tax 2026',
        file_count: 0,
      },
    })
    expect(audit).toMatchObject({
      targetType: 'folder',
      targetId: 'f-new',
      targetName: 'Tax 2026',
    })
  })

  it.each([
    ['its ID', 'f-reports'],
    ['its path', 'Work/Reports'],
    [
      'its path in another letter case, with slashes around it',
      '/work/reports/',
    ],
  ])('creates a subfolder in the parent named by %s', async (_how, parent) => {
    mocks.create.mockResolvedValue(folder('f-new', '2026', 'f-reports'))
    const { structured } = await call('save_folder', { name: '2026', parent })
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
      name: '2026',
      parentId: 'f-reports',
    })
    expect(structured.folder).toMatchObject({ path: 'Work/Reports/2026' })
  })

  it('finds a parent by its name alone when one folder has it', async () => {
    mocks.create.mockResolvedValue(folder('f-new', '2026', 'f-taxes'))
    const { structured } = await call('save_folder', {
      name: '2026',
      parent: 'taxes',
    })
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('owner', {
      name: '2026',
      parentId: 'f-taxes',
    })
    expect(structured.folder).toMatchObject({ path: 'Personal/Taxes/2026' })
  })

  it('refuses a name several folders share and lists their paths', async () => {
    const refusal = call('save_folder', { name: '2026', parent: 'Reports' })
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(/Personal\/Reports, Work\/Reports/)
    await expect(
      call('save_folder', { name: 'Archive', folder: 'reports' })
    ).rejects.toThrow(/Personal\/Reports, Work\/Reports/)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a folder that does not exist and says where to look', async () => {
    await expect(
      call('save_folder', { name: 'Archive', folder: 'Missing' })
    ).rejects.toThrow(/list_folders/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('renames a folder and sends nothing about sharing', async () => {
    mocks.update.mockResolvedValue(
      folder('f-reports', 'Archive', 'f-work', {
        fileCount: 12,
        shareToken: TOKEN,
      })
    )
    const { structured, audit } = await call('save_folder', {
      folder: 'Work/Reports',
      name: 'Archive',
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 'f-reports', {
      name: 'Archive',
    })
    expect(mocks.update.mock.calls[0][2]).not.toHaveProperty('sharing')
    expect(structured).toEqual({
      folder: {
        id: 'f-reports',
        path: 'Work/Archive',
        name: 'Archive',
        file_count: 12,
        share_url: `https://flare.test/s/folders/${TOKEN}`,
      },
    })
    expect(audit).toMatchObject({ targetType: 'folder', targetId: 'f-reports' })
  })

  it('does not offer to move a folder', async () => {
    await expect(
      call('save_folder', {
        folder: 'Work/Reports',
        name: 'Reports',
        parent: 'Personal',
      })
    ).rejects.toThrow(/cannot move a folder/)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses the names the route refuses, in its words', async () => {
    // The server answers a schema refusal with its first issue's message.
    for (const [name, message] of [
      ['a/b', 'Choose a name without slashes; "." and ".." are reserved.'],
      ['   ', 'Give your folder a name.'],
      ['x'.repeat(81), 'Folder names can be up to 80 characters.'],
    ])
      await expect(call('save_folder', { name })).rejects.toMatchObject({
        name: 'ZodError',
        issues: [{ message }],
      })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('words a taken name as the folder routes do', async () => {
    mocks.create.mockRejectedValue(conflict('P2002'))
    await expect(
      call('save_folder', { name: 'Reports', parent: 'Work' })
    ).rejects.toMatchObject({
      status: 409,
      message: 'A folder with that name already exists here.',
    })
    mocks.update.mockRejectedValue(conflict('P2002'))
    await expect(
      call('save_folder', { folder: 'Personal/Taxes', name: 'Reports' })
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('delete_folder', () => {
  it('dissolves the folder and says where its contents went', async () => {
    const { structured, audit } = await call('delete_folder', {
      folder: 'Work/Reports',
    })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('owner', 'f-reports')
    expect(structured).toEqual({
      id: 'f-reports',
      path: 'Work/Reports',
      contents_moved_to: 'Work',
    })
    expect(audit).toMatchObject({
      targetType: 'folder',
      targetId: 'f-reports',
      targetName: 'Reports',
    })
  })

  it('leaves out the destination when the contents moved to the top level', async () => {
    const { structured } = await call('delete_folder', { folder: 'f-work' })
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('owner', 'f-work')
    expect(structured).toEqual({ id: 'f-work', path: 'Work' })
  })

  it("passes on the service's name conflict as it words it", async () => {
    const message =
      'A subfolder has the same name as a folder one level up. Rename it before deleting this folder.'
    mocks.remove.mockRejectedValue(new HttpError(409, message))
    await expect(
      call('delete_folder', { folder: 'Personal' })
    ).rejects.toMatchObject({ status: 409, message })
  })

  it('says in its description that nothing in the folder is deleted', () => {
    expect(tool('delete_folder').description).toMatch(
      /without deleting what is in it/
    )
    expect(tool('delete_folder').description).toMatch(/move up one level/)
  })
})

describe('set_folder_sharing', () => {
  it('creates the public link through the folder update and answers it', async () => {
    mocks.update.mockResolvedValue(
      folder('f-taxes', 'Taxes', 'f-personal', { shareToken: TOKEN })
    )
    const { structured, audit } = await call('set_folder_sharing', {
      folder: 'Personal/Taxes',
      shared: true,
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 'f-taxes', {
      sharing: true,
    })
    expect(mocks.update.mock.calls[0][2]).not.toHaveProperty('name')
    expect(structured).toEqual({
      folder: {
        id: 'f-taxes',
        path: 'Personal/Taxes',
        name: 'Taxes',
        file_count: 0,
        share_url: `https://flare.test/s/folders/${TOKEN}`,
      },
    })
    expect(audit).toMatchObject({ targetType: 'folder', targetId: 'f-taxes' })
  })

  it('revokes the link and answers the folder without one', async () => {
    mocks.update.mockResolvedValue(
      folder('f-reports', 'Reports', 'f-work', { fileCount: 12 })
    )
    const { structured } = await call('set_folder_sharing', {
      folder: 'f-reports',
      shared: false,
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('owner', 'f-reports', {
      sharing: false,
    })
    expect(structured.folder).toEqual({
      id: 'f-reports',
      path: 'Work/Reports',
      name: 'Reports',
      file_count: 12,
    })
  })

  it('needs both folder permissions the route checks', () => {
    expect([...TOOL_CATALOG.set_folder_sharing.permissions].sort()).toEqual([
      'folders.manage',
      'folders.share',
    ])
  })
})
