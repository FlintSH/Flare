import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SharedArchiveAccess } from '@/lib/archives/sharing'
import { type AuditContext, auditContext } from '@/lib/audit/context'
import { DEFAULT_CONFIG } from '@/lib/config'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import { TOOL_CATALOG, type ToolName, type ToolRow } from '@/lib/mcp/catalog'
import { type McpRequestExtra, mcpHandler } from '@/lib/mcp/server'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'

// The seven tools that act on another account's content, run through the
// real server and access rule, over stand-ins for the services under them.
type Account = {
  id: string
  name: string
  email: string
  sessionVersion: number
}
type StoredFile = {
  id: string
  name: string
  userId: string
  urlPath: string
  path: string
  mimeType: string
  size: number
  uploadedAt: Date
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  isPaste: boolean
  isOcrProcessed: boolean
  ocrText: string | null
  storageTarget: null
}

const world = vi.hoisted(() => ({
  accounts: [] as Account[],
  files: [] as StoredFile[],
}))
const mocks = vi.hoisted(() => ({
  accountFilesPage: vi.fn(),
  updateFileSettings: vi.fn(),
  deleteFile: vi.fn(),
  fileListPage: vi.fn(),
  listOwnShortLinks: vi.fn(),
  deleteOwnShortLink: vi.fn(),
  listAccountShortLinks: vi.fn(),
  findAccountShortLink: vi.fn(),
  deleteAccountShortLink: vi.fn(),
  listArchive: vi.fn(),
  readArchiveEntry: vi.fn(),
  listSharedArchive: vi.fn(),
  readSharedArchiveEntry: vi.fn(),
  stream: vi.fn(),
  thumbnail: vi.fn(),
  downloadUrl: vi.fn(),
  entryUrl: vi.fn(),
}))

/** The few queries the tools make themselves, answered from `world`. */
vi.mock('@/lib/database/prisma', () => {
  type Where = Record<string, unknown>
  const pick = <T extends object>(row: T | undefined) => row ?? null
  const ciEquals = (value: string, where: unknown) =>
    value.toLowerCase() ===
    String((where as { equals: string }).equals).toLowerCase()
  const summary = (account: Account) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    image: null,
    roles: [],
  })
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: { where: Where }) => {
          const account = world.accounts.find(
            (candidate) =>
              (where.id !== undefined && candidate.id === where.id) ||
              (where.email !== undefined && candidate.email === where.email)
          )
          return account
            ? { ...summary(account), sessionVersion: account.sessionVersion }
            : null
        },
        findMany: async ({ where, take }: { where: Where; take: number }) =>
          world.accounts
            .filter((account) =>
              'email' in where
                ? ciEquals(account.email, where.email)
                : ciEquals(account.name, where.name)
            )
            .slice(0, take)
            .map(summary),
      },
      file: {
        findUnique: async ({ where }: { where: Where }) =>
          pick(
            world.files.find(
              (file) =>
                (where.id !== undefined && file.id === where.id) ||
                (where.urlPath !== undefined && file.urlPath === where.urlPath)
            )
          ),
        findFirst: async ({ where }: { where: Where }) =>
          pick(
            world.files.find(
              (file) => file.id === where.id && file.userId === where.userId
            )
          ),
        findMany: async ({
          where,
        }: {
          where: { id: { in: string[] }; userId: string }
        }) =>
          world.files
            .filter(
              (file) =>
                where.id.in.includes(file.id) && file.userId === where.userId
            )
            .map(({ id, name }) => ({ id, name })),
      },
    },
  }
})
vi.mock('@/lib/files/manage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files/manage')>()),
  accountFilesPage: mocks.accountFilesPage,
  updateFileSettings: mocks.updateFileSettings,
  deleteFile: mocks.deleteFile,
}))
vi.mock('@/lib/files/list', () => ({
  fileListPage: mocks.fileListPage,
  accountFileTypes: async () => ['text/plain'],
}))
vi.mock('@/lib/links/service', () => ({
  createShortLink: vi.fn(),
  listOwnShortLinks: mocks.listOwnShortLinks,
  deleteOwnShortLink: mocks.deleteOwnShortLink,
  listAccountShortLinks: mocks.listAccountShortLinks,
  findAccountShortLink: mocks.findAccountShortLink,
  deleteAccountShortLink: mocks.deleteAccountShortLink,
}))
vi.mock('@/lib/archives/service', () => ({
  listArchive: mocks.listArchive,
  readArchiveEntry: mocks.readArchiveEntry,
  listSharedArchive: mocks.listSharedArchive,
  readSharedArchiveEntry: mocks.readSharedArchiveEntry,
}))
vi.mock('@/lib/mcp/publish-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/publish-check')>()),
  archiveActor: async () => ({ owner: true }),
}))
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  getStorageProvider: async () => ({ getFileStream: mocks.stream }),
}))
vi.mock('@/lib/files/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files/thumbnail')>()),
  resizedThumbnail: mocks.thumbnail,
}))
vi.mock('@/lib/files/expiry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files/expiry')>()),
  getFilesExpirationInfo: async () => new Map(),
}))
vi.mock('@/lib/folders/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/folders/service')>()),
  listFolders: async () => [],
}))
vi.mock('@/lib/tags/manage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tags/manage')>()),
  listTags: async () => [],
}))
vi.mock('@/lib/mcp/transfer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/transfer')>()),
  createDownloadUrl: mocks.downloadUrl,
  createEntryUrl: mocks.entryUrl,
}))
// Only the tools of this stage, whatever else the index is still gaining.
vi.mock('@/lib/mcp/tools', async () => ({
  TOOLS: [
    ...(await import('@/lib/mcp/tools/account')).accountTools,
    ...(await import('@/lib/mcp/tools/files')).fileTools,
    ...(await import('@/lib/mcp/tools/links')).linksTools,
    ...(await import('@/lib/mcp/tools/organize')).organizeTools,
  ],
}))

const ENDPOINT = 'https://flare.test/api/mcp'
const MODERATED: ToolName[] = [
  'search_files',
  'get_file',
  'read_file',
  'list_short_links',
  'set_file_sharing',
  'delete_files',
  'delete_short_link',
]

function principal(
  scopes: string[],
  permissions: readonly string[],
  userId = 'moderator'
): AgentPrincipal {
  return {
    user: {
      id: userId,
      storageUsed: 0,
      urlId: 'mo',
      vanityId: null,
      permissions: [...permissions] as never,
      roles: [],
      randomizeFileUrls: false,
      credential: 'token',
      apiToken: { id: 't1', scopes: [...scopes, 'mcp'], profileId: null },
    },
    name: 'Mo',
    scopes,
    credentialKey: `token:${randomUUID()}`,
    can: (permission) => hasPermission({ permissions }, permission),
  }
}

/** The `content.*` permission each tool's moderator mode needs. */
const needed = (name: ToolName) =>
  (TOOL_CATALOG[name] as ToolRow).moderation!.permissions[0]
/** A moderator who may use the tool on other accounts and on nothing of its own. */
const moderatorOf = (name: ToolName) =>
  principal(['admin:content'], [needed(name)])
/** An account that may use the tool on its own content and not moderate. */
const ownerOf = (name: ToolName) => {
  const row: ToolRow = TOOL_CATALOG[name]
  return principal([...row.scopes], DEFAULT_PERMISSIONS, 'sam')
}

type Listed = {
  name: string
  inputSchema: { properties?: Record<string, unknown>; required?: string[] }
}

async function rpc(
  who: AgentPrincipal,
  method: string,
  params?: Record<string, unknown>
) {
  const calling =
    method === 'tools/call' && Object.hasOwn(TOOL_CATALOG, String(params?.name))
      ? (params!.name as ToolName)
      : null
  const response = await mcpHandler().fetch(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    {
      authInfo: {
        token: '',
        clientId: who.credentialKey,
        scopes: [...who.scopes],
        extra: { principal: who, calling } satisfies McpRequestExtra,
      },
    }
  )
  const text = await response.text()
  return JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text) as {
    result?: {
      tools?: Listed[]
      isError?: boolean
      content?: { type: string; text?: string }[]
      structuredContent?: Record<string, unknown>
    }
    error?: { message: string }
  }
}

async function call(
  who: AgentPrincipal,
  name: string,
  args: Record<string, unknown> = {}
) {
  const audit: AuditContext = {}
  const answer = await auditContext.run(audit, () =>
    rpc(who, 'tools/call', { name, arguments: args })
  )
  const text =
    answer.error?.message ??
    (answer.result?.content ?? []).map(({ text }) => text ?? '').join('\n')
  const first = answer.result?.content?.[0]?.text
  let data: Record<string, unknown> | undefined
  try {
    data = first ? JSON.parse(first) : undefined
  } catch {
    data = undefined
  }
  return {
    refused: answer.result?.isError === true || Boolean(answer.error),
    text,
    data,
    audit,
  }
}

const file = (override: Partial<StoredFile>): StoredFile => ({
  id: 'file-x',
  name: 'notes.txt',
  userId: 'sam',
  urlPath: '/sam/notes.txt',
  path: 'uploads/sam/notes.txt',
  mimeType: 'text/plain',
  size: 10 / (1024 * 1024),
  uploadedAt: new Date('2026-11-01T00:00:00.000Z'),
  visibility: 'PUBLIC',
  password: null,
  isPaste: false,
  isOcrProcessed: false,
  ocrText: null,
  storageTarget: null,
  ...override,
})

/** Every service a moderator call could reach, to check that none was. */
const services = () =>
  [
    mocks.accountFilesPage,
    mocks.updateFileSettings,
    mocks.deleteFile,
    mocks.fileListPage,
    mocks.listOwnShortLinks,
    mocks.deleteOwnShortLink,
    mocks.listAccountShortLinks,
    mocks.findAccountShortLink,
    mocks.deleteAccountShortLink,
    mocks.listArchive,
    mocks.readArchiveEntry,
    mocks.listSharedArchive,
    mocks.readSharedArchiveEntry,
    mocks.stream,
    mocks.thumbnail,
    mocks.downloadUrl,
    mocks.entryUrl,
  ].filter((mock) => mock.mock.calls.length)

const samLink = {
  id: 'link-sam',
  shortCode: 'abc123',
  targetUrl: 'https://example.com/sam',
  clicks: 4,
  createdAt: '2026-11-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  world.accounts = [
    {
      id: 'moderator',
      name: 'Mo',
      email: 'mo@example.com',
      sessionVersion: 2,
    },
    { id: 'sam', name: 'Sam', email: 'sam@example.com', sessionVersion: 1 },
    { id: 'tess', name: 'Tess', email: 'tess@example.com', sessionVersion: 1 },
    // Two accounts chose the same name.
    { id: 'twin-1', name: 'Twin', email: 'one@example.com', sessionVersion: 1 },
    { id: 'twin-2', name: 'twin', email: 'two@example.com', sessionVersion: 1 },
  ]
  world.files = [
    file({ id: 'file-sam', name: 'secret.txt', visibility: 'PRIVATE' }),
    file({
      id: 'file-sam-locked',
      name: 'locked.txt',
      urlPath: '/sam/locked.txt',
      password: '$2b$10$hashhashhash',
    }),
    file({
      id: 'file-sam-zip',
      name: 'bundle.zip',
      urlPath: '/sam/bundle.zip',
      mimeType: 'application/zip',
    }),
    file({
      id: 'file-tess',
      name: 'tess.txt',
      userId: 'tess',
      urlPath: '/tess/tess.txt',
    }),
  ]
  mocks.accountFilesPage.mockResolvedValue({
    files: [
      {
        id: 'file-sam',
        name: 'secret.txt',
        mimeType: 'text/plain',
        size: 1,
        visibility: 'PRIVATE',
        hasPassword: true,
        uploadedAt: new Date('2026-11-01T00:00:00.000Z'),
        urlPath: '/sam/secret.txt',
        isPaste: false,
      },
    ],
    pagination: { total: 41, pages: 3, page: 1, limit: 20 },
  })
  mocks.fileListPage.mockResolvedValue({
    files: [],
    pagination: { total: 0, pageCount: 0, page: 1, limit: 20 },
  })
  mocks.updateFileSettings.mockImplementation(async (_who, id) => ({
    id,
    urlPath: `/sam/${id}`,
    visibility: 'PRIVATE',
    hasPassword: false,
  }))
  mocks.deleteFile.mockResolvedValue(undefined)
  mocks.listOwnShortLinks.mockResolvedValue([])
  mocks.listAccountShortLinks.mockResolvedValue({
    urls: [samLink],
    pagination: { total: 1, pages: 1, page: 1, limit: 20 },
  })
  mocks.findAccountShortLink.mockImplementation(
    async (userId: string, { id, shortCode }) =>
      userId === 'sam' && (id === samLink.id || shortCode === samLink.shortCode)
        ? samLink
        : null
  )
  mocks.deleteAccountShortLink.mockResolvedValue(undefined)
  mocks.stream.mockImplementation(async () =>
    Readable.from([Buffer.from('hello sam')])
  )
  mocks.listSharedArchive.mockImplementation(async () =>
    Response.json({
      data: {
        entries: [{ path: 'a.txt', type: 'file', size: 3 }],
        listed: 1,
        extraction: { available: false },
      },
    })
  )
  mocks.downloadUrl.mockResolvedValue({
    url: 'https://flare.test/api/mcp/transfer/secret',
    expires_at: '2026-11-21T12:10:00.000Z',
  })
  mocks.entryUrl.mockResolvedValue({
    url: 'https://flare.test/api/mcp/transfer/entry',
    expires_at: '2026-11-21T12:10:00.000Z',
  })
})

/** One call of each tool on Sam's content, and how to name a third account's. */
const cases: Record<
  ToolName,
  { args: Record<string, unknown>; foreign?: Record<string, unknown> }
> = {
  search_files: { args: { query: 'secret' } },
  get_file: { args: { file: 'file-sam' }, foreign: { file: 'file-tess' } },
  read_file: { args: { file: 'file-sam' }, foreign: { file: 'file-tess' } },
  list_short_links: { args: { query: 'sam' } },
  set_file_sharing: {
    args: { files: ['file-sam'], visibility: 'public' },
    foreign: { files: ['file-tess'], visibility: 'public' },
  },
  delete_files: {
    args: { files: ['file-sam'] },
    foreign: { files: ['file-tess'] },
  },
  delete_short_link: {
    args: { link: 'abc123' },
    foreign: { link: 'tess-link' },
  },
} as never

describe('the account argument in listed schemas', () => {
  it('is in exactly the seven moderating tools, for a connection that may moderate them all', async () => {
    const who = principal(
      [
        'files:read',
        'files:content',
        'files:share',
        'files:delete',
        'files:organize',
        'urls:read',
        'urls:write',
        'admin:content',
      ],
      [
        ...DEFAULT_PERMISSIONS,
        'content.read',
        'content.update',
        'content.delete',
      ]
    )
    const tools = (await rpc(who, 'tools/list')).result?.tools ?? []
    expect(
      tools
        .filter((tool) => tool.inputSchema.properties?.account)
        .map((tool) => tool.name)
        .sort()
    ).toEqual([...MODERATED].sort())
    // Optional: each of them also works on the connection's own content.
    for (const tool of tools)
      expect(tool.inputSchema.required ?? []).not.toContain('account')
  })
})

describe.each(MODERATED)('%s in moderator mode', (name) => {
  const { args, foreign } = cases[name]

  it('acts on the named account through the moderator service path, and never as that account', async () => {
    const answer = await call(moderatorOf(name), name, {
      ...args,
      account: 'sam@example.com',
    })
    expect(answer.refused, answer.text).toBe(false)
    // Nothing of the owner's own path ran.
    expect(mocks.fileListPage).not.toHaveBeenCalled()
    expect(mocks.listOwnShortLinks).not.toHaveBeenCalled()
    expect(mocks.deleteOwnShortLink).not.toHaveBeenCalled()
    expect(mocks.listArchive).not.toHaveBeenCalled()
    expect(mocks.readArchiveEntry).not.toHaveBeenCalled()
    const authority = { as: 'moderator', accountId: 'sam' }
    switch (name) {
      case 'search_files':
        expect(mocks.accountFilesPage).toHaveBeenCalledWith('sam', {
          page: 1,
          limit: 20,
          search: 'secret',
          visibility: '',
          type: '',
        })
        expect(answer.audit).toMatchObject({
          targetType: 'user',
          targetId: 'sam',
        })
        break
      case 'get_file':
      case 'read_file':
        expect(answer.data).toMatchObject(
          name === 'get_file'
            ? { file: { id: 'file-sam' } }
            : { id: 'file-sam' }
        )
        expect(answer.audit).toMatchObject({
          targetType: 'file',
          targetId: 'file-sam',
        })
        break
      case 'list_short_links':
        expect(mocks.listAccountShortLinks).toHaveBeenCalledWith('sam', {
          page: 1,
          limit: 20,
          search: 'sam',
        })
        expect(answer.audit).toMatchObject({
          targetType: 'user',
          targetId: 'sam',
        })
        break
      case 'set_file_sharing':
        expect(mocks.updateFileSettings).toHaveBeenCalledWith(
          authority,
          'file-sam',
          { visibility: 'PUBLIC' }
        )
        break
      case 'delete_files':
        expect(mocks.deleteFile).toHaveBeenCalledWith(authority, 'file-sam')
        break
      case 'delete_short_link':
        expect(mocks.findAccountShortLink).toHaveBeenCalledWith('sam', {
          id: 'abc123',
          shortCode: 'abc123',
        })
        expect(mocks.deleteAccountShortLink).toHaveBeenCalledWith(
          'sam',
          'link-sam'
        )
        expect(answer.audit).toMatchObject({
          targetType: 'link',
          targetId: 'link-sam',
        })
        break
    }
  })

  if (foreign)
    it("answers a third account's file or link exactly as a missing one, and changes nothing", async () => {
      const who = moderatorOf(name)
      const theirs = await call(who, name, { ...foreign, account: 'sam' })
      vi.clearAllMocks()
      const unknown = await call(who, name, {
        ...JSON.parse(
          JSON.stringify(foreign).replace(/file-tess|tess-link/, 'nothing-here')
        ),
        account: 'sam',
      })
      expect(theirs.refused).toBe(true)
      // Word for word, apart from the reference the caller gave.
      expect(theirs.text.replace(/file-tess|tess-link/g, 'X')).toBe(
        unknown.text.replace(/nothing-here/g, 'X')
      )
      // Nothing of the other account but the reference the caller gave.
      expect(theirs.text.replace(/file-tess|tess-link/g, 'X')).not.toMatch(
        /tess/i
      )
      expect(mocks.updateFileSettings).not.toHaveBeenCalled()
      expect(mocks.deleteFile).not.toHaveBeenCalled()
      expect(mocks.deleteAccountShortLink).not.toHaveBeenCalled()
      expect(mocks.stream).not.toHaveBeenCalled()
      expect(mocks.downloadUrl).not.toHaveBeenCalled()
    })

  const refusals: [string, AgentPrincipal][] = [
    ['without admin:content', principal([], [needed(name)])],
    [
      `without ${needed(name)}`,
      principal(
        ['admin:content'],
        ['content.read', 'content.update', 'content.delete'].filter(
          (permission) => permission !== needed(name)
        )
      ),
    ],
    // The authenticator drops every admin:* scope while administration is
    // off, whatever the credential holds; this is what a tool is then given.
    [
      'while administration is off',
      principal([], [needed(name), 'administrator']),
    ],
  ]

  it.each(refusals)(
    'is refused %s, with nothing read or changed',
    async (_what, who) => {
      const answer = await call(who, name, { ...args, account: 'sam' })
      expect(answer.refused).toBe(true)
      expect(answer.text).toMatch(/^Not allowed on another account's content: /)
      expect(answer.audit.outcome).toBe('denied')
      expect(services()).toEqual([])
    }
  )

  it('works for a connection that may only moderate, and is refused without account', async () => {
    const who = moderatorOf(name)
    expect((await call(who, name, { ...args, account: 'sam' })).refused).toBe(
      false
    )
    vi.clearAllMocks()
    const own = await call(who, name, args)
    expect(own.refused).toBe(true)
    expect(own.text).toMatch(/^Not allowed: /)
    expect(services()).toEqual([])
  })

  it('works on its own content for a connection that may not moderate, and is refused with account', async () => {
    const who = ownerOf(name)
    const moderating = await call(who, name, { ...args, account: 'tess' })
    expect(moderating.refused).toBe(true)
    expect(moderating.text).toMatch(
      /^Not allowed on another account's content: /
    )
    expect(services()).toEqual([])
    const own = await call(who, name, args)
    // Its own call reaches its own path, whatever it finds there.
    expect(mocks.accountFilesPage).not.toHaveBeenCalled()
    expect(mocks.listAccountShortLinks).not.toHaveBeenCalled()
    expect(mocks.deleteAccountShortLink).not.toHaveBeenCalled()
    for (const [authority] of [
      ...mocks.updateFileSettings.mock.calls,
      ...mocks.deleteFile.mock.calls,
    ])
      expect(authority).toEqual({ as: 'owner', userId: 'sam' })
    expect(own.text).not.toMatch(/^Not allowed/)
  })

  it.each([
    ['naming nobody', 'nobody@example.com'],
    ['naming several accounts', 'twin'],
    ['empty', '   '],
  ])(
    'refuses an account %s without naming anyone, and reads nothing',
    async (_what, account) => {
      const answer = await call(moderatorOf(name), name, { ...args, account })
      expect(answer.refused).toBe(true)
      for (const person of world.accounts) {
        expect(answer.text).not.toContain(person.email)
        expect(answer.text).not.toContain(person.id)
      }
      expect(answer.text).not.toMatch(/Twin|Sam|Tess/)
      expect(services()).toEqual([])
    }
  )
})

describe('what a moderator sees and may do', () => {
  const reader = () => principal(['admin:content'], ['content.read'])

  it('lists files with what the moderation listing carries: no folder, tags, counts or expiry', async () => {
    const answer = await call(reader(), 'search_files', {
      account: 'sam',
      type: 'image',
      visibility: 'private',
      limit: 20,
      cursor: Buffer.from(JSON.stringify({ o: 20 })).toString('base64url'),
    })
    expect(mocks.accountFilesPage).toHaveBeenCalledWith('sam', {
      page: 2,
      limit: 20,
      search: '',
      visibility: 'private',
      type: 'image/',
    })
    expect(answer.data).toEqual({
      files: [
        {
          id: 'file-sam',
          name: 'secret.txt',
          type: 'text/plain',
          size_bytes: 1048576,
          uploaded_at: '2026-11-01T00:00:00.000Z',
          visibility: 'private',
          has_password: true,
          url: 'https://flare.test/sam/secret.txt',
        },
      ],
      total: 41,
      next_cursor: Buffer.from(JSON.stringify({ o: 40 })).toString('base64url'),
    })
  })

  it.each<[string, string]>([
    ['search_files', 'files'],
    ['list_short_links', 'links'],
  ])(
    '%s answers a page past the end with nothing, not the last page again',
    async (name, rows) => {
      // The account had more when the cursor was made. The listing clamps a
      // page past the end to the last one, which the caller has seen.
      mocks.accountFilesPage.mockResolvedValue({
        files: (await mocks.accountFilesPage()).files,
        pagination: { total: 1, pages: 1, page: 1, limit: 20 },
      })
      const answer = await call(reader(), name, {
        account: 'sam',
        cursor: Buffer.from(JSON.stringify({ o: 20 })).toString('base64url'),
      })
      expect(answer.refused, answer.text).toBe(false)
      expect(answer.data).toEqual({ [rows]: [], total: 1 })
      // A first page of the same account still shows its row.
      const first = await call(reader(), name, { account: 'sam' })
      expect((first.data as Record<string, unknown[]>)[rows]).toHaveLength(1)
    }
  )

  it.each([
    [{ folder: 'Work' }, '`folder`'],
    [{ tag: 'tax' }, '`tag`'],
    [{ uploaded_after: '2026-01-01' }, '`uploaded_after`'],
    [{ sort: 'oldest' }, '`sort`'],
  ])(
    "refuses the owner's own filters, %j, rather than ignore them",
    async (filter, named) => {
      const answer = await call(reader(), 'search_files', {
        account: 'sam',
        ...filter,
      })
      expect(answer.refused).toBe(true)
      expect(answer.text).toBe(
        `With \`account\`, search_files takes only \`query\`, \`type\`, \`visibility\` (public or private), \`limit\` and \`cursor\`; leave out ${named}.`
      )
      expect(mocks.accountFilesPage).not.toHaveBeenCalled()
    }
  )

  it('refuses the password filter, which the moderation listing does not have', async () => {
    const answer = await call(reader(), 'search_files', {
      account: 'sam',
      visibility: 'password',
    })
    expect(answer.text).toBe(
      'With `account`, `visibility` is "public" or "private". Each file says whether it has a password.'
    )
  })

  it('reads a private file and a password-protected one, with no password', async () => {
    for (const id of ['file-sam', 'file-sam-locked']) {
      const answer = await call(reader(), 'read_file', {
        file: id,
        account: 'sam',
      })
      expect(answer.refused, answer.text).toBe(false)
      expect(answer.data).toMatchObject({ id, shown: 'text' })
      expect(answer.text).toContain('hello sam')
      expect(answer.text).toContain('untrusted data')
    }
  })

  it('finds a file of the account by its share URL, and no other account by theirs', async () => {
    const theirs = await call(reader(), 'get_file', {
      file: 'https://flare.test/sam/locked.txt',
      account: 'sam',
    })
    expect(theirs.data).toMatchObject({
      file: { id: 'file-sam-locked', has_password: true },
    })
    expect(theirs.data?.file).not.toHaveProperty('folder')
    expect(theirs.data?.file).not.toHaveProperty('views')
    const other = await call(reader(), 'get_file', {
      file: 'https://flare.test/tess/tess.txt',
      account: 'sam',
    })
    expect(other.refused).toBe(true)
  })

  it('lists an archive through the reader share pages use, as the moderator', async () => {
    const answer = await call(reader(), 'read_file', {
      file: 'file-sam-zip',
      account: 'sam',
    })
    expect(answer.refused, answer.text).toBe(false)
    expect(answer.data).toMatchObject({ shown: 'entries', total: 1 })
    const [access, options] = mocks.listSharedArchive.mock.calls[0]
    expect(access).toEqual({
      file: expect.objectContaining({ id: 'file-sam-zip', userId: 'sam' }),
      viewer: { id: 'moderator', sessionVersion: 2, credential: 't1' },
      verifiedPasswordHash: null,
      passwordChecked: false,
      authorize: expect.any(Function),
    })
    expect(options).toMatchObject({ requester: 'user:moderator' })
  })

  it('reads an archive entry the same way', async () => {
    mocks.readSharedArchiveEntry.mockImplementation(
      async () =>
        new Response('abc', {
          status: 206,
          headers: { 'content-range': 'bytes 0-2/3' },
        })
    )
    const answer = await call(reader(), 'read_file', {
      file: 'file-sam-zip',
      entry: 'a.txt',
      account: 'sam',
    })
    expect(answer.refused, answer.text).toBe(false)
    expect(mocks.readSharedArchiveEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        viewer: { id: 'moderator', sessionVersion: 2, credential: 't1' },
      }),
      { path: 'a.txt' },
      expect.any(Request),
      { inline: false, requester: 'user:moderator' }
    )
  })

  it('makes its download links as a moderator for the account', async () => {
    mocks.readSharedArchiveEntry.mockImplementation(
      async () =>
        new Response('\u0000\u0001', {
          status: 206,
          headers: { 'content-range': 'bytes 0-1/2' },
        })
    )
    const who = reader()
    await call(who, 'read_file', {
      file: 'file-sam',
      account: 'sam',
      download_url: true,
    })
    expect(mocks.downloadUrl).toHaveBeenCalledWith(
      who,
      'https://flare.test',
      'file-sam',
      'sam'
    )
    await call(who, 'read_file', {
      file: 'file-sam-zip',
      entry: 0,
      account: 'sam',
      download_url: true,
    })
    expect(mocks.entryUrl).toHaveBeenCalledWith(
      who,
      'https://flare.test',
      'file-sam-zip',
      { position: 0 },
      'sam'
    )
  })

  it('pages links with whole pages of one size', async () => {
    const answer = await call(reader(), 'list_short_links', {
      account: 'sam',
      limit: 10,
      cursor: Buffer.from(JSON.stringify({ o: 5 })).toString('base64url'),
    })
    expect(answer.text).toBe(
      'With `account`, keep the same `limit` while paging with a cursor, or start again without one.'
    )
    expect(mocks.listAccountShortLinks).not.toHaveBeenCalled()
  })

  it('answers per file when a batch names files of several accounts', async () => {
    const answer = await call(
      principal(['admin:content'], ['content.delete']),
      'delete_files',
      { files: ['file-sam', 'file-tess'], account: 'sam' }
    )
    expect(answer.data).toEqual({
      results: [
        { id: 'file-sam', name: 'secret.txt', ok: true },
        {
          id: 'file-tess',
          ok: false,
          error:
            'No file of that account has this ID. Use search_files with the same `account` to find it.',
        },
      ],
    })
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['move_files', { files: ['file-sam'], folder: 'none' }],
    ['tag_files', { files: ['file-sam'], add: ['x'] }],
    ['set_file_expiry', { files: ['file-sam'], expires_at: null }],
    ['create_short_link', { url: 'https://example.com' }],
  ])(
    'gets nothing only an owner has: %s takes no account',
    async (tool, args) => {
      const who = principal(
        ['admin:content', 'files:upload', 'files:organize', 'urls:write'],
        [
          ...DEFAULT_PERMISSIONS,
          'content.read',
          'content.update',
          'content.delete',
        ]
      )
      const listed = (await rpc(who, 'tools/list')).result?.tools ?? []
      const schema = listed.find((candidate) => candidate.name === tool)
      expect(schema?.inputSchema.properties ?? {}).not.toHaveProperty('account')
      // A client that sends one anyway is refused, not run on its own account.
      const answer = await call(who, tool, { ...args, account: 'sam' })
      expect(answer.refused).toBe(true)
      expect(answer.text).toMatch(
        new RegExp(`^${tool} acts only on this connection's own account`)
      )
      expect(services()).toEqual([])
    }
  )
})

describe('a slow moderator archive read, rechecked against what moderating needs', () => {
  type Held = {
    token?: Record<string, unknown> | null
    connection?: Record<string, unknown> | null
    enabled?: boolean
    administration?: boolean
    permissions?: string[]
  }
  /** The transaction the reader's locked recheck hands the hook, as things stand then. */
  function transaction(held: Held = {}) {
    const {
      enabled = true,
      administration = true,
      permissions = ['content.read'],
    } = held
    const value = structuredClone(DEFAULT_CONFIG)
    value.settings.general.mcp = { enabled, administration }
    const raw = {
      $queryRaw: vi.fn(async () => []),
      apiToken: {
        findUnique: vi.fn(async () =>
          held.token === null
            ? null
            : {
                id: 't1',
                scopes: ['mcp', 'admin:content'],
                revokedAt: null,
                expiresAt: null,
                ...held.token,
              }
        ),
      },
      agentConnection: {
        findUnique: vi.fn(async () =>
          held.connection === null
            ? null
            : {
                revokedAt: null,
                scopes: ['admin:content'],
                createdAt: new Date(),
                ...held.connection,
              }
        ),
      },
      config: { findUnique: vi.fn(async () => ({ value })) },
      user: {
        findUnique: vi.fn(async () => ({
          roles: [
            {
              id: 'mods',
              name: 'Moderators',
              description: '',
              color: '#000000',
              position: 1,
              systemKey: null,
              permissions,
            },
          ],
        })),
      },
      role: { findUnique: vi.fn(async () => null) },
    }
    return { tx: raw as unknown as Prisma.TransactionClient, raw }
  }
  const ENDED =
    "This connection was disconnected, lost the access to other accounts' content this call needs, or administration through MCP was turned off while the call was running."

  /** A moderator that signed in through the browser, with no token. */
  const connected = () => {
    const who = principal(['admin:content'], ['content.read'])
    delete who.user.apiToken
    who.user.credential = 'agent'
    who.user.agentConnection = { id: 'c1', scopes: ['admin:content'] }
    return who
  }

  /** The state the recheck sees, set by each case before the reader reaches it. */
  let atRecheck = transaction()
  beforeEach(() => {
    atRecheck = transaction()
    // The reader rechecks once the slow part is done, as the real one does
    // after staging the archive; the hook is what is being tried.
    mocks.listSharedArchive.mockImplementation(
      async (access: SharedArchiveAccess) => {
        await access.authorize!(atRecheck.tx)
        return Response.json({
          data: {
            entries: [{ path: 'a.txt', type: 'file', size: 3 }],
            listed: 1,
            extraction: { available: false },
          },
        })
      }
    )
    mocks.readSharedArchiveEntry.mockImplementation(
      async (access: SharedArchiveAccess) => {
        await access.authorize!(atRecheck.tx)
        return new Response('abc', {
          status: 206,
          headers: { 'content-range': 'bytes 0-2/3' },
        })
      }
    )
  })

  const reads: [string, Record<string, unknown>][] = [
    ['listing', { file: 'file-sam-zip', account: 'sam' }],
    ['entry read', { file: 'file-sam-zip', entry: 'a.txt', account: 'sam' }],
  ]

  describe.each(reads)('a %s', (_what, args) => {
    it('goes ahead while everything still holds', async () => {
      const answer = await call(
        principal(['admin:content'], ['content.read']),
        'read_file',
        args
      )
      expect(answer.refused, answer.text).toBe(false)
    })

    it.each<[string, () => AgentPrincipal, Held]>([
      [
        'its token was revoked',
        () => principal(['admin:content'], ['content.read']),
        { token: { revokedAt: new Date() } },
      ],
      [
        'its token lost the moderation scope',
        () => principal(['admin:content'], ['content.read']),
        { token: { scopes: ['mcp', 'files:read'] } },
      ],
      [
        'the agent was disconnected',
        connected,
        { connection: { revokedAt: new Date() } },
      ],
      [
        'its connection lost the moderation scope',
        connected,
        { connection: { scopes: ['files:read'] } },
      ],
      [
        'administration through MCP was turned off',
        () => principal(['admin:content'], ['content.read']),
        { administration: false },
      ],
      ['the MCP server was turned off', connected, { enabled: false }],
      [
        "the role no longer reads other accounts' content",
        () => principal(['admin:content'], ['content.read']),
        { permissions: ['content.delete'] },
      ],
    ])('is refused when %s meanwhile', async (_change, who, held) => {
      atRecheck = transaction(held)
      const answer = await call(who(), 'read_file', args)
      expect(answer.refused).toBe(true)
      expect(answer.text).toBe(ENDED)
      expect(answer.audit.outcome).toBe('denied')
    })
  })

  it('hands the reader the credential the moderator came with, for the audit log', async () => {
    const args = { file: 'file-sam-zip', account: 'sam' }
    const viewerOf = (index: number) =>
      (mocks.listSharedArchive.mock.calls[index][0] as SharedArchiveAccess)
        .viewer
    // A named token is recorded by its ID, a sign-in by its connection key.
    await call(
      principal(['admin:content'], ['content.read']),
      'read_file',
      args
    )
    expect(viewerOf(0)).toMatchObject({ credential: 't1' })
    const signedIn = connected()
    await call(signedIn, 'read_file', args)
    expect(viewerOf(1)).toMatchObject({ credential: signedIn.credentialKey })
  })

  it("holds a named token's row before reading it, through the transaction only", async () => {
    await call(principal(['admin:content'], ['content.read']), 'read_file', {
      file: 'file-sam-zip',
      account: 'sam',
    })
    const { raw } = atRecheck
    const [statement, id] = raw.$queryRaw.mock.calls[0] as unknown as [
      string[],
      string,
    ]
    expect(statement.join('?')).toBe(
      'SELECT "id" FROM "ApiToken" WHERE "id" = ? FOR SHARE'
    )
    expect(id).toBe('t1')
    expect(raw.apiToken.findUnique).toHaveBeenCalledOnce()
    expect(raw.config.findUnique).toHaveBeenCalled()
    expect(raw.user.findUnique).toHaveBeenCalledOnce()
  })
})
