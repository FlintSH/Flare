import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuditTarget } from '@/lib/audit'
import { type AuditContext, auditContext } from '@/lib/audit/context'
import type { FolderView } from '@/lib/folders/schema'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'
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
import { organizeTools } from '@/lib/mcp/tools/organize'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import type { TagView } from '@/lib/tags/schema'

const mocks = vi.hoisted(() => ({
  files: vi.fn(),
  folders: vi.fn(),
  move: vi.fn(),
  tags: vi.fn(),
  changeTags: vi.fn(),
  membership: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  settings: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findMany: mocks.files } },
}))
vi.mock('@/lib/files/delivery', () => ({ findFile: vi.fn() }))
vi.mock('@/lib/folders/service', () => ({
  listFolders: mocks.folders,
  moveFilesToFolder: mocks.move,
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
}))
vi.mock('@/lib/tags/manage', () => ({
  listTags: mocks.tags,
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}))
vi.mock('@/lib/tags/service', () => ({
  changeFileTags: mocks.changeTags,
  applyTagToExistingFiles: vi.fn(),
}))
vi.mock('@/lib/tags/membership', () => ({
  fileTagMembership: mocks.membership,
}))
vi.mock('@/lib/files/expiry', () => ({
  scheduleFileExpiration: mocks.schedule,
  cancelFileExpiration: mocks.cancel,
}))
// The real settings schema reads the arguments, as it reads the route's body.
vi.mock('@/lib/files/manage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files/manage')>()),
  updateFileSettings: mocks.settings,
  deleteFile: mocks.remove,
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
  (organizeTools as ToolDefinition[]).find(
    (candidate) => candidate.name === name
  )!

type Grant = { scopes: readonly string[]; permissions: readonly Permission[] }

/**
 * Calls a tool the way the server does: arguments through its input schema,
 * inside a request's audit context. Without a grant the credential holds
 * what the tool's row asks for and no more. The answer must be exactly what
 * the output schema describes, with nothing left over.
 */
async function call(name: ToolName, args: unknown, grant?: Grant) {
  const audit: AuditContext = {}
  const row: ToolRow = TOOL_CATALOG[name]
  const context = contextFor(
    name,
    grant?.scopes ?? row.scopes,
    grant?.permissions ?? row.permissions
  )
  const { structured } = await auditContext.run(audit, () =>
    tool(name).run(tool(name).input.parse(args) as never, context)
  )
  expect(tool(name).output.parse(structured)).toEqual(structured)
  return {
    structured: structured as Record<string, never>,
    audit,
    user: context.principal.user,
  }
}

/** The account's files; anything else is someone else's or does not exist. */
const library = [
  { id: 'f1', name: 'one.png' },
  { id: 'f2', name: 'two.txt' },
  { id: 'f3', name: 'three.pdf' },
]

const folder = (
  id: string,
  name: string,
  parentId: string | null = null
): FolderView => ({ id, name, parentId, fileCount: 0, shareToken: null })

const tag = (id: string, name: string): TagView => ({
  id,
  name,
  ruleSource: null,
  ruleText: null,
  fileCount: 0,
})

const missing = new HttpError(404, 'File not found')

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
  mocks.files.mockImplementation(
    async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
      where.userId === 'owner'
        ? library.filter((file) => where.id.in.includes(file.id))
        : []
  )
  mocks.folders.mockResolvedValue([
    folder('f-work', 'Work'),
    folder('f-reports', 'Reports', 'f-work'),
    folder('f-archive-1', 'Archive', 'f-work'),
    folder('f-personal', 'Personal'),
    folder('f-archive-2', 'Archive', 'f-personal'),
  ])
  mocks.tags.mockResolvedValue([
    tag('t-work', 'Work'),
    tag('t-old', 'Old'),
    tag('t-2026', '2026'),
  ])
})

describe('move_files', () => {
  it.each([
    ['its path', 'Work/Reports'],
    ['its ID', 'f-reports'],
    ['its name', 'reports'],
  ])('moves the files into the folder named by %s', async (_how, value) => {
    mocks.move.mockResolvedValue(2)
    const { structured, audit } = await call('move_files', {
      files: ['f1', 'f2'],
      folder: value,
    })
    expect(mocks.move).toHaveBeenCalledExactlyOnceWith('owner', {
      fileIds: ['f1', 'f2'],
      folderId: 'f-reports',
    })
    expect(structured).toEqual({ moved: 2, folder: 'Work/Reports' })
    expect(audit).toMatchObject({ targetType: 'file', targetName: '2 files' })
  })

  it('takes files out of folders with "none"', async () => {
    mocks.move.mockResolvedValue(1)
    const { structured, audit } = await call('move_files', {
      files: ['f1'],
      folder: 'None',
    })
    expect(mocks.move).toHaveBeenCalledExactlyOnceWith('owner', {
      fileIds: ['f1'],
      folderId: null,
    })
    expect(mocks.folders).not.toHaveBeenCalled()
    expect(structured).toEqual({ moved: 1 })
    expect(audit).toMatchObject({
      targetType: 'file',
      targetId: 'f1',
      targetName: 'one.png',
    })
  })

  it('refuses a folder name several folders share and lists their paths', async () => {
    const refusal = call('move_files', { files: ['f1'], folder: 'archive' })
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(/Personal\/Archive, Work\/Archive/)
    expect(mocks.move).not.toHaveBeenCalled()
  })

  it("moves nothing when an ID is not one of the account's files, and names it", async () => {
    const refusal = call('move_files', {
      files: ['f1', 'ghost', 'f2', 'stranger'],
      folder: 'Work',
    })
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(/Nothing was moved.*ghost, stranger/)
    expect(mocks.files).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'ghost', 'f2', 'stranger'] }, userId: 'owner' },
      select: { id: true, name: true },
    })
    expect(mocks.move).not.toHaveBeenCalled()
  })

  it("passes on the service's refusal, and words a vanished row as the folder routes do", async () => {
    mocks.move.mockRejectedValue(
      new HttpError(404, 'One or more files are unavailable.')
    )
    await expect(
      call('move_files', { files: ['f1'], folder: 'Work' })
    ).rejects.toMatchObject({
      status: 404,
      message: 'One or more files are unavailable.',
    })
    mocks.move.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
        code: 'P2003',
        clientVersion: 'test',
      })
    )
    await expect(
      call('move_files', { files: ['f1'], folder: 'Work' })
    ).rejects.toMatchObject({
      status: 404,
      message: 'The folder or file is no longer available.',
    })
  })

  it('takes at most 50 files and says the move is all or nothing', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `f${index}`)
    await expect(
      call('move_files', { files: ids, folder: 'Work' })
    ).rejects.toThrow()
    await expect(
      call('move_files', { files: [], folder: 'Work' })
    ).rejects.toThrow()
    expect(mocks.move).not.toHaveBeenCalled()
    expect(tool('move_files').description).toMatch(/All or nothing/)
  })
})

describe('tag_files', () => {
  beforeEach(() => {
    mocks.changeTags.mockResolvedValue(2)
    mocks.membership.mockImplementation(async (_userId, ids: string[]) =>
      ids.map((id) => ({
        id,
        tags: id === 'f1' ? [{ id: 't-work', name: 'Work' }] : [],
      }))
    )
  })

  it('adds and removes tags named by name or ID, one service call a tag', async () => {
    const { structured, audit } = await call('tag_files', {
      files: ['f1', 'f2'],
      add: ['work', 't-2026'],
      remove: ['t-old'],
    })
    expect(mocks.changeTags.mock.calls).toEqual([
      ['owner', { fileIds: ['f1', 'f2'], tagId: 't-work', action: 'add' }],
      ['owner', { fileIds: ['f1', 'f2'], tagId: 't-2026', action: 'add' }],
      ['owner', { fileIds: ['f1', 'f2'], tagId: 't-old', action: 'remove' }],
    ])
    expect(mocks.membership).toHaveBeenCalledExactlyOnceWith('owner', [
      'f1',
      'f2',
    ])
    expect(structured).toEqual({
      results: [
        { id: 'f1', name: 'one.png', ok: true, tags: ['Work'] },
        { id: 'f2', name: 'two.txt', ok: true, tags: [] },
      ],
    })
    expect(audit).toMatchObject({ targetType: 'file', targetName: '2 files' })
  })

  it('names a tag once however often the call names it', async () => {
    await call('tag_files', { files: ['f1'], add: ['Work', 't-work', 'WORK'] })
    expect(mocks.changeTags).toHaveBeenCalledExactlyOnceWith('owner', {
      fileIds: ['f1'],
      tagId: 't-work',
      action: 'add',
    })
  })

  it("reports an ID that is not the account's file and still tags the others", async () => {
    const { structured } = await call('tag_files', {
      files: ['ghost', 'f1', 'f1'],
      remove: ['Old'],
    })
    expect(mocks.changeTags).toHaveBeenCalledExactlyOnceWith('owner', {
      fileIds: ['f1'],
      tagId: 't-old',
      action: 'remove',
    })
    expect(structured.results).toEqual([
      {
        id: 'ghost',
        ok: false,
        error: expect.stringContaining('search_files'),
      },
      { id: 'f1', name: 'one.png', ok: true, tags: ['Work'] },
    ])
  })

  it('refuses a tag that does not exist before changing anything', async () => {
    await expect(
      call('tag_files', { files: ['f1'], add: ['Work', 'Missing'] })
    ).rejects.toThrow(/No tag matches "Missing".*list_tags/)
    expect(mocks.changeTags).not.toHaveBeenCalled()
  })

  it('refuses a call without tags, and a tag in both lists', async () => {
    await expect(call('tag_files', { files: ['f1'] })).rejects.toBeInstanceOf(
      ToolError
    )
    await expect(
      call('tag_files', { files: ['f1'], add: ['Work'], remove: ['t-work'] })
    ).rejects.toThrow(/"Work" is in both/)
    expect(mocks.changeTags).not.toHaveBeenCalled()
  })

  it('fails the call when no ID is a file of the account', async () => {
    const refusal = call('tag_files', { files: ['ghost'], add: ['Work'] })
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(/No file was changed\. ghost: /)
    expect(mocks.changeTags).not.toHaveBeenCalled()
    expect(mocks.membership).not.toHaveBeenCalled()
  })

  it('stops at a tag the service refuses and says what was already done', async () => {
    mocks.changeTags
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new HttpError(404, 'Tag not found.'))
    const refusal = call('tag_files', {
      files: ['f1'],
      add: ['Work'],
      remove: ['Old', '2026'],
    })
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(
      'Could not remove the tag "Old": Tag not found. Already done in this call: added "Work".'
    )
    expect(mocks.changeTags).toHaveBeenCalledTimes(2)
  })

  it('still answers when the files changed but their tags cannot be read back', async () => {
    mocks.membership.mockRejectedValue(
      new HttpError(404, 'One or more files are no longer available.')
    )
    const { structured } = await call('tag_files', {
      files: ['f1'],
      add: ['Work'],
    })
    expect(structured.results).toEqual([
      { id: 'f1', name: 'one.png', ok: true },
    ])
  })
})

describe('set_file_expiry', () => {
  const WHEN = '2027-01-31T18:00:00+01:00'
  const organize: Grant = {
    scopes: ['files:organize'],
    permissions: ['files.update'],
  }
  beforeEach(() => {
    mocks.schedule.mockResolvedValue(new Date(WHEN))
    mocks.cancel.mockResolvedValue(true)
  })

  it('needs only files:organize and files.update to be called at all', () => {
    expect(TOOL_CATALOG.set_file_expiry).toMatchObject(organize)
  })

  it.each([
    ['delete', 'files:delete', 'files.delete'],
    ['make_private', 'files:share', 'files.share'],
  ] as const)(
    'refuses action %s without the scope and the role permission of what it does',
    async (action, scope, permission) => {
      const args = { files: ['f1', 'f2'], expires_at: WHEN, action }
      for (const grant of [
        // Only what the tool itself needs.
        organize,
        // The role allows it, the connection was not granted it.
        { ...organize, permissions: ['files.update', permission] },
        // The connection was granted it, the role does not allow it.
        { ...organize, scopes: ['files:organize', scope] },
        // The other effect's grant does not stand in for this one.
        {
          scopes: ['files:organize', 'files:delete', 'files:share'].filter(
            (held) => held !== scope
          ),
          permissions: (
            ['files.update', 'files.delete', 'files.share'] as const
          ).filter((held) => held !== permission),
        },
      ] satisfies Grant[]) {
        const refusal = call('set_file_expiry', args, grant)
        await expect(refusal).rejects.toBeInstanceOf(ToolError)
        await expect(refusal).rejects.toMatchObject({ outcome: 'denied' })
      }
      // Refused before any file was looked up, let alone scheduled.
      expect(mocks.files).not.toHaveBeenCalled()
      expect(mocks.schedule).not.toHaveBeenCalled()
      expect(mocks.cancel).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['delete', 'DELETE', 'files:delete', 'files.delete'],
    ['make_private', 'SET_PRIVATE', 'files:share', 'files.share'],
  ] as const)(
    'schedules action %s with the body the route reads, once the scope and permission are held',
    async (action, stored, scope, permission) => {
      const { structured, user, audit } = await call(
        'set_file_expiry',
        { files: ['f1', 'f2'], expires_at: WHEN, action },
        {
          scopes: ['files:organize', scope],
          permissions: ['files.update', permission],
        }
      )
      expect(mocks.schedule.mock.calls).toEqual([
        [user, 'f1', { expiresAt: WHEN, action: stored }],
        [user, 'f2', { expiresAt: WHEN, action: stored }],
      ])
      // The service checks the role itself, so it gets the account, not an ID.
      expect(mocks.schedule.mock.calls[0][0]).toBe(user)
      expect(structured).toEqual({
        expires_at: '2027-01-31T17:00:00.000Z',
        action,
        results: [
          { id: 'f1', name: 'one.png', ok: true },
          { id: 'f2', name: 'two.txt', ok: true },
        ],
      })
      expect(audit).toMatchObject({ targetType: 'file', targetName: '2 files' })
    }
  )

  it('cancels with files:organize alone', async () => {
    mocks.cancel.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { structured } = await call(
      'set_file_expiry',
      { files: ['f1', 'f2'], expires_at: null },
      organize
    )
    expect(mocks.cancel.mock.calls).toEqual([
      ['owner', 'f1'],
      ['owner', 'f2'],
    ])
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(structured).toEqual({
      results: [
        { id: 'f1', name: 'one.png', ok: true, cancelled: true },
        { id: 'f2', name: 'two.txt', ok: true, cancelled: false },
      ],
    })
  })

  it('reports the file that failed and still schedules the others', async () => {
    mocks.schedule.mockImplementation(async (_owner, id: string) => {
      if (id === 'f2') throw missing
      return new Date(WHEN)
    })
    const { structured } = await call(
      'set_file_expiry',
      {
        files: ['f1', 'ghost', 'f2', 'f3'],
        expires_at: WHEN,
        action: 'delete',
      },
      {
        scopes: ['files:organize', 'files:delete'],
        permissions: ['files.update', 'files.delete'],
      }
    )
    // An ID that is not the account's file never reaches the service.
    expect(mocks.schedule.mock.calls.map(([, id]) => id)).toEqual([
      'f1',
      'f2',
      'f3',
    ])
    expect(structured.results).toEqual([
      { id: 'f1', name: 'one.png', ok: true },
      {
        id: 'ghost',
        ok: false,
        error: expect.stringContaining('search_files'),
      },
      { id: 'f2', name: 'two.txt', ok: false, error: 'File not found' },
      { id: 'f3', name: 'three.pdf', ok: true },
    ])
  })

  it("fails the call with the service's reason when no file was scheduled", async () => {
    mocks.schedule.mockRejectedValue(
      new HttpError(400, 'Invalid expiration date. Must be in the future.')
    )
    const refusal = call(
      'set_file_expiry',
      {
        files: ['f1', 'f2'],
        expires_at: '2020-01-01T00:00:00Z',
        action: 'make_private',
      },
      {
        scopes: ['files:organize', 'files:share'],
        permissions: ['files.update', 'files.share'],
      }
    )
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(
      'No expiry was scheduled. f1, f2: Invalid expiration date. Must be in the future.'
    )
  })

  it('never guesses the action, and takes none when cancelling', async () => {
    await expect(
      call('set_file_expiry', { files: ['f1'], expires_at: WHEN }, organize)
    ).rejects.toThrow(/`action` "delete" \(permanent\) or "make_private"/)
    await expect(
      call(
        'set_file_expiry',
        { files: ['f1'], expires_at: null, action: 'delete' },
        organize
      )
    ).rejects.toThrow(/delete_files/)
    // A call that leaves out the time is not read as a cancellation.
    await expect(
      call('set_file_expiry', { files: ['f1'] }, organize)
    ).rejects.toThrow()
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })
})

describe('set_file_sharing', () => {
  const HASH = '$2b$10$abcdefghijklmnopqrstuuJ0nNQ2bq0YV2RkS9mC4E1b8uO7n6h1e'
  /** The stored row the service answers, password hash already replaced. */
  const stored = (id: string, fields: Record<string, unknown> = {}) => ({
    id,
    name: library.find((file) => file.id === id)!.name,
    urlPath: `/alex/${library.find((file) => file.id === id)!.name}`,
    path: `uploads/owner/${id}.bin`,
    userId: 'owner',
    visibility: 'PUBLIC',
    hasPassword: false,
    ocrText: 'text read from the image',
    ...fields,
  })

  it('changes visibility and password with the body the route reads', async () => {
    mocks.settings.mockImplementation(async (_authority, id: string) =>
      stored(id, { visibility: 'PRIVATE', hasPassword: true })
    )
    const { structured, audit } = await call('set_file_sharing', {
      files: ['f1', 'f2'],
      visibility: 'private',
      password: 'correct horse',
    })
    const settings = { visibility: 'PRIVATE', password: 'correct horse' }
    expect(mocks.settings.mock.calls).toEqual([
      [{ as: 'owner', userId: 'owner' }, 'f1', settings],
      [{ as: 'owner', userId: 'owner' }, 'f2', settings],
    ])
    expect(structured).toEqual({
      results: [
        {
          id: 'f1',
          name: 'one.png',
          ok: true,
          visibility: 'private',
          has_password: true,
          url: 'https://flare.test/alex/one.png',
        },
        {
          id: 'f2',
          name: 'two.txt',
          ok: true,
          visibility: 'private',
          has_password: true,
          url: 'https://flare.test/alex/two.txt',
        },
      ],
    })
    expect(audit).toMatchObject({ targetType: 'file', targetName: '2 files' })
  })

  it('never answers the password, its hash or where the file is stored', async () => {
    mocks.settings.mockImplementation(async (_authority, id: string) =>
      stored(id, { hasPassword: true, password: HASH })
    )
    const { structured } = await call('set_file_sharing', {
      files: ['f1'],
      password: 'correct horse',
    })
    const sent = JSON.stringify(structured)
    for (const secret of ['correct horse', HASH, 'uploads/', 'text read'])
      expect(sent).not.toContain(secret)
    expect(Object.keys(structured.results[0]).sort()).toEqual([
      'has_password',
      'id',
      'name',
      'ok',
      'url',
      'visibility',
    ])
  })

  it('sends only what the call changes', async () => {
    mocks.settings.mockImplementation(async (_authority, id: string) =>
      stored(id)
    )
    await call('set_file_sharing', { files: ['f1'], password: null })
    expect(mocks.settings.mock.calls[0][2]).toStrictEqual({ password: null })
    await call('set_file_sharing', { files: ['f1'], visibility: 'public' })
    expect(mocks.settings.mock.calls[1][2]).toStrictEqual({
      visibility: 'PUBLIC',
    })
  })

  it('refuses a password the route refuses, before any file changes', async () => {
    await expect(
      call('set_file_sharing', { files: ['f1', 'f2'], password: 'short' })
    ).rejects.toMatchObject({
      name: 'ZodError',
      issues: [{ message: 'File passwords must be at least 8 characters.' }],
    })
    await expect(
      call('set_file_sharing', { files: ['f1'] })
    ).rejects.toBeInstanceOf(ToolError)
    expect(mocks.settings).not.toHaveBeenCalled()
  })

  it('reports the file that failed and still changes the others', async () => {
    mocks.settings.mockImplementation(async (_authority, id: string) => {
      if (id === 'f1') throw missing
      return stored(id, { visibility: 'PRIVATE' })
    })
    const { structured } = await call('set_file_sharing', {
      files: ['f1', 'f2', 'stranger'],
      visibility: 'private',
    })
    expect(mocks.settings).toHaveBeenCalledTimes(2)
    expect(structured.results).toEqual([
      { id: 'f1', name: 'one.png', ok: false, error: 'File not found' },
      {
        id: 'f2',
        name: 'two.txt',
        ok: true,
        visibility: 'private',
        has_password: false,
        url: 'https://flare.test/alex/two.txt',
      },
      {
        id: 'stranger',
        ok: false,
        error: expect.stringContaining('search_files'),
      },
    ])
  })
})

describe('delete_files', () => {
  beforeEach(() => {
    // Like the service, the stand-in names each file as the audit target.
    mocks.remove.mockImplementation(async (_authority, id: string) => {
      setAuditTarget({ type: 'file', id, name: `deleted ${id}` })
    })
  })

  it('deletes each file as its owner, once', async () => {
    const { structured, audit } = await call('delete_files', {
      files: ['f1', 'f2', 'f1'],
    })
    expect(mocks.remove.mock.calls).toEqual([
      [{ as: 'owner', userId: 'owner' }, 'f1'],
      [{ as: 'owner', userId: 'owner' }, 'f2'],
    ])
    expect(structured).toEqual({
      results: [
        { id: 'f1', name: 'one.png', ok: true },
        { id: 'f2', name: 'two.txt', ok: true },
      ],
    })
    // A batch is recorded as one, not as its last file.
    expect(audit.targetName).toBe('2 files')
    expect(audit.targetId).toBeUndefined()
  })

  it('names the file in the audit event when the call deletes one', async () => {
    const { audit } = await call('delete_files', { files: ['f3'] })
    expect(audit).toMatchObject({
      targetType: 'file',
      targetId: 'f3',
      targetName: 'three.pdf',
    })
  })

  it('reports the file that failed and still deletes the others', async () => {
    const broken = new Error('connection reset')
    mocks.remove.mockImplementation(async (_authority, id: string) => {
      if (id === 'f1') throw missing
      if (id === 'f2') throw broken
    })
    const { structured } = await call('delete_files', {
      files: ['f1', 'f2', 'ghost', 'f3'],
    })
    expect(mocks.remove.mock.calls.map(([, id]) => id)).toEqual([
      'f1',
      'f2',
      'f3',
    ])
    expect(structured.results).toEqual([
      { id: 'f1', name: 'one.png', ok: false, error: 'File not found' },
      {
        id: 'f2',
        name: 'two.txt',
        ok: false,
        // What broke is logged, not sent.
        error: expect.stringMatching(/^Flare could not complete this/),
      },
      {
        id: 'ghost',
        ok: false,
        error: expect.stringContaining('search_files'),
      },
      { id: 'f3', name: 'three.pdf', ok: true },
    ])
    expect(JSON.stringify(structured)).not.toContain('connection reset')
    expect(loggers.api.error).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      broken
    )
  })

  it("fails the call when it deleted nothing, and never asks the service about another account's file", async () => {
    const refusal = call('delete_files', { files: ['ghost', 'stranger'] })
    await expect(refusal).rejects.toBeInstanceOf(ToolError)
    await expect(refusal).rejects.toThrow(
      /^No file was deleted\. ghost, stranger: No file of this account/
    )
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('says in its description that deleting is permanent and Flare has no trash', () => {
    expect(tool('delete_files').description).toMatch(/Permanently delete/)
    expect(tool('delete_files').description).toMatch(/Flare has no trash/)
  })
})
