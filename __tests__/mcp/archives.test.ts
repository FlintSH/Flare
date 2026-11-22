import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArchiveError } from '@/lib/archives/errors'
import type { ArchiveActor } from '@/lib/archives/http'
import { ArchiveOperation } from '@/lib/archives/operation'
import { type AuditContext, auditContext } from '@/lib/audit/context'
import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_CONFIG } from '@/lib/config'
import { HttpError } from '@/lib/http/errors'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import { TOOL_CATALOG } from '@/lib/mcp/catalog'
import {
  archiveActor,
  credentialHolds,
  stillAllowed,
} from '@/lib/mcp/publish-check'
import {
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from '@/lib/mcp/tool'
import { archivesTools } from '@/lib/mcp/tools/archives'
import { uploadsTools } from '@/lib/mcp/tools/uploads'
import {
  MAX_OUTSTANDING_TRANSFERS,
  TransferLimitError,
} from '@/lib/mcp/transfer'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'
import { PermissionError } from '@/lib/permissions/server'
import { StorageTargetChangedError } from '@/lib/storage/target-provider'
import { UploadError } from '@/lib/uploads/options'

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  create: vi.fn(),
  account: vi.fn(),
  profiles: vi.fn(),
  files: vi.fn(),
  file: vi.fn(),
  folders: vi.fn(),
  createTransfer: vi.fn(),
  countTransfers: vi.fn(),
}))
// The archive services, which the tools only call: what they are handed, and
// what the tools make of their refusals, is what these tests are about. The
// operation that bounds them is the real one.
vi.mock('@/lib/archives/service', () => ({
  extractArchive: mocks.extract,
  createAccountArchive: mocks.create,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.account },
    uploadProfile: { findMany: mocks.profiles },
    file: { findMany: mocks.files, findUnique: mocks.file },
    // A transfer URL is made in one transaction, under its account's lock.
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRaw: async () => [],
        agentTransfer: {
          deleteMany: vi.fn(async () => ({ count: 0 })),
          count: mocks.countTransfers,
          create: mocks.createTransfer,
        },
      }),
  },
}))
vi.mock('@/lib/folders/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/folders/service')>()),
  listFolders: mocks.folders,
}))

const ORIGIN = 'https://flare.test'

const user: AuthenticatedUser = {
  id: 'owner',
  storageUsed: 0,
  urlId: 'owner',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  credential: 'token',
  apiToken: {
    id: 'token-1',
    scopes: ['mcp', 'files:read', 'files:content', 'files:upload'],
    profileId: null,
  },
}

function principalOf(overrides: Partial<AuthenticatedUser> = {}) {
  const account = { ...user, ...overrides }
  const principal: AgentPrincipal = {
    user: account,
    name: 'Alex',
    scopes: ['files:read', 'files:content', 'files:upload', 'urls:read'],
    credentialKey: account.agentConnection
      ? `connection:${account.agentConnection.id}`
      : 'token:token-1',
    can: (permission) => hasPermission(account, permission),
  }
  return principal
}

function context(
  overrides: {
    user?: Partial<AuthenticatedUser>
    origin?: string
    request?: Request
  } = {}
): ToolContext {
  return {
    principal: principalOf(overrides.user),
    request:
      overrides.request ?? new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }),
    origin: overrides.origin ?? ORIGIN,
    moderating: null,
    mayModerate: false,
    requireModeration: () => {},
    allows: () => true,
    recheck: async () => {},
    requireEffect: () => {},
  }
}
const bound = () =>
  context({
    user: {
      apiToken: {
        id: 'token-1',
        scopes: ['mcp', 'files:read', 'files:content', 'files:upload'],
        profileId: 'profile-shots',
      },
    },
  })

const tool = (name: string): ToolDefinition => {
  const found = archivesTools.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`No tool called ${name}`)
  return found as unknown as ToolDefinition
}

/** One call as the server makes it: arguments through the input schema, the answer through the output schema. */
async function call(
  name: string,
  args: Record<string, unknown>,
  toolContext = context()
) {
  const { input, output, run } = tool(name)
  const answer = await run(input.parse(args), toolContext)
  // Strict, so a field the schema does not declare fails here as in a client.
  expect(output.strict().parse(answer.structured)).toEqual(answer.structured)
  return answer.structured as Record<string, never>
}

/** The refusal a call ends in, which must be one worded for an agent. */
async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

/** A file row as the tools read it. */
const stored = (override: Record<string, unknown> = {}) => ({
  id: 'file-zip',
  name: 'backup.zip',
  urlPath: '/owner/backup.zip',
  mimeType: 'application/zip',
  userId: 'owner',
  ...override,
})
/** Files by ID, as the database finds them. */
function library(...rows: ReturnType<typeof stored>[]) {
  mocks.file.mockImplementation(
    async ({ where }: { where: { id?: string; urlPath?: string } }) =>
      rows.find((row) =>
        where.id ? row.id === where.id : row.urlPath === where.urlPath
      ) ?? null
  )
  mocks.files.mockImplementation(
    async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
      rows.filter(
        (row) => where.id.in.includes(row.id) && row.userId === where.userId
      )
  )
}

const folder = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  shareToken: null,
  fileCount: 0,
})

/** What each service was handed on its only call. */
function handed(service: 'extract' | 'create') {
  expect(mocks[service]).toHaveBeenCalledOnce()
  const args = mocks[service].mock.calls[0]
  return service === 'extract'
    ? {
        actor: args[0] as ArchiveActor,
        id: args[1] as string,
        input: args[2],
        operation: args[3] as ArchiveOperation,
      }
    : {
        actor: args[0] as ArchiveActor,
        id: undefined,
        input: args[1],
        operation: args[2] as ArchiveOperation,
      }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.account.mockResolvedValue({ sessionVersion: 4 })
  const updatedAt = new Date('2026-11-01T00:00:00.000Z')
  mocks.profiles.mockResolvedValue([
    { id: 'profile-shots', name: 'Screenshots', options: {}, updatedAt },
    { id: 'profile-docs', name: 'Docs', options: {}, updatedAt },
  ])
  mocks.folders.mockResolvedValue([
    folder('folder-work', 'Work'),
    folder('folder-reports', 'Reports', 'folder-work'),
  ])
  library(
    stored(),
    stored({
      id: 'file-a',
      name: 'a.txt',
      urlPath: '/owner/a.txt',
      mimeType: 'text/plain',
    }),
    stored({
      id: 'file-b',
      name: 'b.txt',
      urlPath: '/owner/b.txt',
      mimeType: 'text/plain',
    }),
    stored({ id: 'file-theirs', userId: 'someone-else' })
  )
  mocks.extract.mockResolvedValue({
    folderId: 'folder-new',
    fileCount: 3,
    totalBytes: 4096,
  })
  mocks.create.mockResolvedValue({
    file: {
      id: 'file-new',
      name: 'bundle.zip',
      urlPath: '/owner/bundle.zip',
      folderId: null,
    },
    totalBytes: 2048,
  })
  mocks.countTransfers.mockResolvedValue(0)
  mocks.createTransfer.mockResolvedValue({})
})

const EXTRACT = { file: 'file-zip', folder_name: 'Unpacked' }
const CREATE = { files: ['file-a', 'file-b'], name: 'bundle', format: 'zip' }

/** What every refusal of the services means for an agent, by tool. */
const EXTRACT_ADVICE =
  'To read single files from this archive, call read_file with `entry`.'
const CREATE_ADVICE = 'Pack fewer or smaller files.'
const BUSY =
  'Another archive operation is running: Flare runs one for an account at a time, and 2 at once on this server. Nothing was created. Wait for it to finish, which takes up to 2 minutes, then call again.'
const SIGNED_OUT =
  'The account was signed out everywhere, or removed, while this call was running. Nothing was created. If this connection still works, call again.'
const CHANGED =
  'Nothing was created. Look at what is there now, then call again.'

describe('the tools that create things', () => {
  // A misspelled argument is refused, not dropped: dropped, the files would
  // land somewhere the caller did not ask for.
  it.each([
    [
      'extract_archive',
      { file: 'file-zip', folder_name: 'A', parentFolder: 'Work' },
    ],
    [
      'create_archive',
      { files: ['file-a'], name: 'A', format: 'zip', folderId: 'folder-work' },
    ],
  ] as const)('%s refuses an argument it does not have', (name, args) => {
    expect(tool(name).input.safeParse(args).success).toBe(false)
  })
})

describe('extract_archive', () => {
  it('extracts into a new folder through the archive service, in one operation for the account', async () => {
    mocks.folders
      .mockResolvedValueOnce([folder('folder-work', 'Work')])
      // As the library has it once the folder is made.
      .mockResolvedValue([
        folder('folder-work', 'Work'),
        folder('folder-new', 'Unpacked'),
      ])
    const toolContext = context()
    const answer = await call('extract_archive', EXTRACT, toolContext)
    expect(answer).toEqual({
      folder: { id: 'folder-new', path: 'Unpacked' },
      files_created: 3,
    })
    const { actor, id, input, operation } = handed('extract')
    expect(id).toBe('file-zip')
    // What the route reads from its request body, and nothing else.
    expect(input).toEqual({ folderId: null, name: 'Unpacked', profileId: null })
    // The account the credential acts as, on the session version it is on.
    expect(actor.user).toBe(toolContext.principal.user)
    expect(actor.sessionVersion).toBe(4)
    expect(actor.authorize).toEqual(expect.any(Function))
    expect(mocks.account).toHaveBeenCalledWith({
      where: { id: 'owner' },
      select: { sessionVersion: true },
    })
    // The services' own operation: it bounds the work and holds the slot.
    expect(operation).toBeInstanceOf(ArchiveOperation)
    expect(operation.directory).toMatch(/flare-archive-/)
  })

  it.each([
    ['its ID', 'file-zip'],
    ['its share URL', 'https://flare.test/owner/backup.zip'],
    ['its /user/name path', '/owner/backup.zip'],
  ])('finds the archive by %s', async (_how, file) => {
    await call('extract_archive', { ...EXTRACT, file })
    expect(handed('extract').id).toBe('file-zip')
  })

  it.each([
    ['its path', 'Work/Reports', 'folder-reports'],
    ['its name', 'reports', 'folder-reports'],
    ['its ID', 'folder-work', 'folder-work'],
  ])(
    'makes the new folder inside the one named by %s',
    async (_how, parent, folderId) => {
      await call('extract_archive', { ...EXTRACT, parent_folder: parent })
      expect(handed('extract').input).toEqual({
        folderId,
        name: 'Unpacked',
        profileId: null,
      })
    }
  )

  it('makes it at the top level without a parent, or with "none"', async () => {
    await call('extract_archive', { ...EXTRACT, parent_folder: 'None' })
    expect(handed('extract').input).toMatchObject({ folderId: null })
  })

  it('refuses a parent folder the account does not have, before any work', async () => {
    const error = await refused(
      call('extract_archive', { ...EXTRACT, parent_folder: 'Nowhere' })
    )
    expect(error.message).toBe(
      'No folder matches "Nowhere". Call list_folders to see the folders and their paths.'
    )
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('answers the path the new folder has in the library', async () => {
    mocks.folders.mockResolvedValue([
      folder('folder-work', 'Work'),
      folder('folder-reports', 'Reports', 'folder-work'),
      folder('folder-new', 'Unpacked', 'folder-reports'),
    ])
    const answer = await call('extract_archive', {
      ...EXTRACT,
      parent_folder: 'Work/Reports',
    })
    expect(answer.folder).toEqual({
      id: 'folder-new',
      path: 'Work/Reports/Unpacked',
    })
  })

  it('answers where the folder was made when it is gone from the library an instant later', async () => {
    const answer = await call('extract_archive', {
      ...EXTRACT,
      folder_name: '  Unpacked  ',
      parent_folder: 'Work',
    })
    // The name as the service's schema reads it, under the parent it named.
    expect(answer.folder).toEqual({ id: 'folder-new', path: 'Work/Unpacked' })
  })

  it.each([
    ['a/b', 'Choose a name without slashes; "." and ".." are reserved.'],
    ['..', 'Choose a name without slashes; "." and ".." are reserved.'],
  ])(
    'refuses the folder name %j as the service does, naming the argument',
    async (name, message) => {
      const error = await refused(
        call('extract_archive', { ...EXTRACT, folder_name: name })
      )
      expect(error.message).toBe(`\`folder_name\`: ${message}`)
      expect(mocks.extract).not.toHaveBeenCalled()
    }
  )

  it('takes a folder name of 1 to 80 characters', () => {
    const { input } = tool('extract_archive')
    for (const name of ['', 'x'.repeat(81)])
      expect(input.safeParse({ ...EXTRACT, folder_name: name }).success).toBe(
        false
      )
    expect(
      input.safeParse({ ...EXTRACT, folder_name: 'x'.repeat(80) }).success
    ).toBe(true)
  })

  it.each([
    ['notes.txt', 'text/plain'],
    ['backup.rar', 'application/vnd.rar'],
    ['report.pdf', 'application/pdf'],
  ])('refuses %s, which Flare cannot extract', async (name, mimeType) => {
    library(stored({ name, mimeType }))
    const error = await refused(call('extract_archive', EXTRACT))
    expect(error.message).toBe(
      'This file is not an archive Flare can extract. It extracts zip, tar, tar.gz, tgz and gz files.'
    )
    expect(mocks.extract).not.toHaveBeenCalled()
    // No operation was taken for it: the account can start one at once.
    new ArchiveOperation('owner', new AbortController().signal).release()
  })

  it("answers another account's archive as a missing file, and starts nothing", async () => {
    for (const file of ['file-theirs', 'file-missing']) {
      const error = await refused(call('extract_archive', { ...EXTRACT, file }))
      expect(error.message).toBe(
        `No file of this account matches "${file}". Use search_files to find it.`
      )
    }
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it('names the archive as the audit target', async () => {
    const audit: AuditContext = {}
    await auditContext.run(audit, () => call('extract_archive', EXTRACT))
    expect(audit).toMatchObject({
      targetType: 'file',
      targetId: 'file-zip',
      targetName: 'backup.zip',
    })
  })
})

describe('create_archive', () => {
  it('packs the files through the archive service and answers the new file as an upload is answered', async () => {
    mocks.file.mockResolvedValue({ mimeType: 'application/zip' })
    const toolContext = context()
    const answer = await call('create_archive', CREATE, toolContext)
    expect(answer).toEqual({
      file: {
        id: 'file-new',
        name: 'bundle.zip',
        type: 'application/zip',
        size_bytes: 2048,
        url: `${ORIGIN}/owner/bundle.zip`,
        raw_url: `${ORIGIN}/api/files/owner/bundle.zip`,
        download_url: `${ORIGIN}/api/files/file-new/download`,
      },
    })
    const { actor, input, operation } = handed('create')
    // What the route reads from its request body, and nothing else.
    expect(input).toEqual({
      fileIds: ['file-a', 'file-b'],
      name: 'bundle',
      format: 'zip',
      folderId: null,
      profileId: null,
    })
    expect(actor.user).toBe(toolContext.principal.user)
    expect(actor.sessionVersion).toBe(4)
    expect(actor.authorize).toEqual(expect.any(Function))
    expect(operation).toBeInstanceOf(ArchiveOperation)
    // The type is read from the file the service made.
    expect(mocks.file).toHaveBeenLastCalledWith({
      where: { id: 'file-new' },
      select: { mimeType: true },
    })
  })

  it('answers in exactly the shape upload_file answers a new file in', () => {
    const shapeOf = (definition: ToolDefinition) =>
      Object.fromEntries(
        Object.entries(
          (definition.output.shape.file as unknown as ToolDefinition['output'])
            .shape
        ).map(([key, field]) => [
          key,
          [field.def.type, (field as { description?: string }).description],
        ])
      )
    const upload = uploadsTools.find(({ name }) => name === 'upload_file')!
    expect(Object.keys(tool('create_archive').output.shape)).toEqual(['file'])
    expect(shapeOf(tool('create_archive'))).toEqual(
      shapeOf(upload as unknown as ToolDefinition)
    )
  })

  it('makes a tar.gz when asked, with the type the service stored', async () => {
    mocks.create.mockResolvedValue({
      file: {
        id: 'file-new',
        name: 'bundle.tar.gz',
        urlPath: '/owner/bundle.tar.gz',
        folderId: null,
      },
      totalBytes: 512,
    })
    mocks.file.mockResolvedValue({ mimeType: 'application/gzip' })
    const answer = await call('create_archive', { ...CREATE, format: 'tar.gz' })
    expect(handed('create').input).toMatchObject({ format: 'tar.gz' })
    expect(answer.file).toMatchObject({
      name: 'bundle.tar.gz',
      type: 'application/gzip',
      size_bytes: 512,
    })
  })

  it("links the new archive under the owner's vanity address", async () => {
    mocks.file.mockResolvedValue({ mimeType: 'application/zip' })
    const answer = await call(
      'create_archive',
      CREATE,
      context({ user: { vanityId: 'alexandra' } })
    )
    expect(answer.file).toMatchObject({
      url: `${ORIGIN}/alexandra/bundle.zip`,
      raw_url: `${ORIGIN}/api/files/owner/bundle.zip`,
    })
  })

  it('takes one format of the two, and 1 to 100 files', () => {
    const { input } = tool('create_archive')
    for (const format of ['rar', '7z', 'tar', 'gz', ''])
      expect(input.safeParse({ ...CREATE, format }).success, format).toBe(false)
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `file-${index}`)
    expect(input.safeParse({ ...CREATE, files: [] }).success).toBe(false)
    expect(input.safeParse({ ...CREATE, files: ids(101) }).success).toBe(false)
    expect(input.safeParse({ ...CREATE, files: ids(100) }).success).toBe(true)
  })

  it('packs a file named twice once', async () => {
    mocks.file.mockResolvedValue({ mimeType: 'application/zip' })
    await call('create_archive', {
      ...CREATE,
      files: ['file-a', 'file-b', 'file-a'],
    })
    expect(handed('create').input).toMatchObject({
      fileIds: ['file-a', 'file-b'],
    })
  })

  it("refuses files the account does not have, naming them, and never another account's", async () => {
    const error = await refused(
      call('create_archive', {
        ...CREATE,
        files: ['file-a', 'file-theirs', 'file-missing'],
      })
    )
    expect(error.message).toBe(
      'No file of this account matches "file-theirs", "file-missing". Use search_files to find the files to pack.'
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it.each([
    ['its path', 'Work/Reports', 'folder-reports'],
    ['its ID', 'folder-work', 'folder-work'],
  ])('puts the archive in the folder named by %s', async (_how, into, id) => {
    mocks.file.mockResolvedValue({ mimeType: 'application/zip' })
    await call('create_archive', { ...CREATE, folder: into })
    expect(handed('create').input).toMatchObject({ folderId: id })
  })

  it('puts it in no folder without one, or with "none"', async () => {
    mocks.file.mockResolvedValue({ mimeType: 'application/zip' })
    await call('create_archive', { ...CREATE, folder: 'none' })
    expect(handed('create').input).toMatchObject({ folderId: null })
  })

  it.each([
    ['a/b.zip', 'Use a plain filename without slashes.'],
    ['..', 'Use a plain filename without slashes.'],
    ['   ', 'Too small: expected string to have >=1 characters'],
  ])(
    'refuses the name %j as the service does, naming the argument',
    async (name, message) => {
      const error = await refused(call('create_archive', { ...CREATE, name }))
      expect(error.message).toBe(`\`name\`: ${message}`)
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it('says so when the archive was made and removed before it could be answered', async () => {
    mocks.file.mockResolvedValue(null)
    const error = await refused(call('create_archive', CREATE))
    expect(error.message).toBe(
      'The archive was made and then removed before this call could answer. Call search_files to see what is there now.'
    )
  })

  it('names the new archive as the audit target once the service has made it', async () => {
    mocks.file.mockResolvedValue({ mimeType: 'application/zip' })
    const { setAuditTarget } = await import('@/lib/audit')
    mocks.create.mockImplementation(async () => {
      // As the service does once the file is published.
      setAuditTarget({ type: 'file', id: 'file-new', name: 'bundle.zip' })
      return {
        file: {
          id: 'file-new',
          name: 'bundle.zip',
          urlPath: '/owner/bundle.zip',
          folderId: null,
        },
        totalBytes: 2048,
      }
    })
    const audit: AuditContext = {}
    await auditContext.run(audit, () => call('create_archive', CREATE))
    expect(audit).toMatchObject({
      targetType: 'file',
      targetId: 'file-new',
      targetName: 'bundle.zip',
    })
  })
})

describe.each([
  ['extract_archive', EXTRACT, 'extract', EXTRACT_ADVICE],
  ['create_archive', CREATE, 'create', CREATE_ADVICE],
] as const)('%s', (name, args, service, advice) => {
  const input = () => handed(service).input as { profileId: string | null }
  beforeEach(() => {
    mocks.file.mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id === 'file-zip'
          ? stored()
          : where.id === 'file-new'
            ? { mimeType: 'application/zip' }
            : null
    )
  })

  describe('the upload profile of what it creates', () => {
    it('is none unless one is named: the results are private, as in the app', async () => {
      await call(name, args)
      expect(input().profileId).toBeNull()
      expect(mocks.profiles).not.toHaveBeenCalled()
    })

    it.each([
      ['its ID', 'profile-docs', 'profile-docs'],
      ['its name', 'Docs', 'profile-docs'],
      ['its name in another case', 'screenshots', 'profile-shots'],
      ['its name between spaces', '  Docs ', 'profile-docs'],
    ])('is the one named by %s', async (_how, profile, id) => {
      await call(name, { ...args, profile })
      expect(input().profileId).toBe(id)
      expect(mocks.profiles).toHaveBeenCalledWith({
        where: { userId: 'owner' },
        orderBy: { name: 'asc' },
      })
    })

    it('is none for "none"', async () => {
      await call(name, { ...args, profile: 'None' })
      expect(input().profileId).toBeNull()
    })

    it('is refused when it cannot be told apart or found, before any work', async () => {
      mocks.profiles.mockResolvedValue([
        { id: 'p1', name: 'Docs' },
        { id: 'p2', name: 'docs' },
      ])
      expect(
        (await refused(call(name, { ...args, profile: 'DOCS' }))).message
      ).toBe(
        'Several upload profiles match "DOCS": Docs, docs. Use the exact name or the profile ID.'
      )
      expect(
        (await refused(call(name, { ...args, profile: 'Nope' }))).message
      ).toBe(
        'No upload profile matches "Nope". Call get_account to see the upload profiles.'
      )
      expect(mocks[service]).not.toHaveBeenCalled()
    })

    describe('for a token bound to an upload profile', () => {
      it('is that profile, selected without being named', async () => {
        await call(name, args, bound())
        expect(input().profileId).toBe('profile-shots')
        // Nothing was named, so nothing was looked up.
        expect(mocks.profiles).not.toHaveBeenCalled()
      })

      it.each([['Screenshots'], ['profile-shots']])(
        'is that profile when it is named as %s',
        async (profile) => {
          await call(name, { ...args, profile }, bound())
          expect(input().profileId).toBe('profile-shots')
        }
      )

      it.each([['Docs'], ['profile-docs'], ['none']])(
        'refuses %s, which is not the profile it is bound to',
        async (profile) => {
          const error = await refused(call(name, { ...args, profile }, bound()))
          expect(error).toMatchObject({
            outcome: 'denied',
            message:
              'This token is bound to an upload profile and publishes only with it. Leave `profile` out.',
          })
          expect(mocks[service]).not.toHaveBeenCalled()
          expect(mocks.account).not.toHaveBeenCalled()
        }
      )

      it('leaves an agent that signed in, which is bound to nothing, as it is', async () => {
        await call(
          name,
          args,
          context({
            user: {
              credential: 'agent',
              apiToken: undefined,
              agentConnection: {
                id: 'connection-1',
                scopes: ['files:content', 'files:upload'],
              },
            },
          })
        )
        expect(input().profileId).toBeNull()
      })
    })
  })

  describe('what the service refuses', () => {
    const NOTHING = 'Nothing was created.'
    const refusals: Array<[string, unknown, string, 'failure' | 'denied']> = [
      [
        'another operation is running',
        new ArchiveError(
          'Another archive operation is running. Try again shortly.',
          429
        ),
        BUSY,
        'failure',
      ],
      [
        'it ran out of time',
        new ArchiveError(
          'Archive operation exceeded the two-minute time limit.',
          408
        ),
        `Archive operation exceeded the two-minute time limit. ${NOTHING} Call again; if it runs out of time again, the files are too large to work on here.`,
        'failure',
      ],
      [
        'a source file changed',
        new ArchiveError(
          'A source file changed or was removed. Refresh and try again.',
          409
        ),
        `A source file changed or was removed. ${CHANGED}`,
        'failure',
      ],
      [
        'the upload profile changed',
        new ArchiveError(
          'The selected upload profile changed or was removed. Refresh and try again.',
          409
        ),
        `The selected upload profile changed or was removed. ${CHANGED}`,
        'failure',
      ],
      [
        "the profile's settings changed",
        new ArchiveError(
          'The selected profile’s effective settings changed. Review the refreshed settings and try again.',
          409
        ),
        `The selected profile’s effective settings changed. ${CHANGED}`,
        'failure',
      ],
      [
        'a folder of that name is already there',
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
        `A folder with that name already exists here. Choose another name. ${CHANGED}`,
        'failure',
      ],
      [
        'a row it uses vanished',
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
        `A source file, account, or destination changed. ${CHANGED}`,
        'failure',
      ],
      [
        'the storage it was recorded on changed',
        new StorageTargetChangedError(),
        `The file storage configuration has changed. Ask the operator to restore its recorded storage target. ${CHANGED}`,
        'failure',
      ],
      [
        'it holds too many entries',
        new ArchiveError('Archives can contain at most 1,000 entries.', 413),
        `Archives can contain at most 1,000 entries. ${NOTHING} ${advice}`,
        'failure',
      ],
      [
        'it unpacks to too much',
        new ArchiveError('Expanded archive contents exceed 512 MiB.', 413),
        `Expanded archive contents exceed 512 MiB. ${NOTHING} ${advice}`,
        'failure',
      ],
      [
        'a file in it is too large',
        new ArchiveError('Archive input exceeds the size limit.', 413),
        `Archive input exceeds the size limit. ${NOTHING} ${advice}`,
        'failure',
      ],
      [
        'the storage quota has no room',
        new HttpError(413, 'This would exceed your storage quota.'),
        `This would exceed your storage quota. ${NOTHING} ${advice}`,
        'failure',
      ],
      [
        'the archive is encrypted',
        new ArchiveError(
          'Encrypted archives are not supported. Decrypt the archive before uploading it.',
          415
        ),
        `Encrypted archives are not supported. Decrypt the archive before uploading it. ${NOTHING} ${advice}`,
        'failure',
      ],
      [
        'the archive is damaged',
        new ArchiveError(
          'The archive is damaged, incomplete, encrypted, or uses an unsupported format.'
        ),
        `The archive is damaged, incomplete, encrypted, or uses an unsupported format. ${NOTHING} ${advice}`,
        'failure',
      ],
      [
        'the account was signed out everywhere meanwhile',
        new ArchiveError('Sign in again before creating files.', 401),
        SIGNED_OUT,
        'denied',
      ],
      [
        'the role no longer allows it',
        new ArchiveError(
          'Your role no longer allows this archive operation.',
          403
        ),
        `Your role no longer allows this archive operation. ${NOTHING}`,
        'denied',
      ],
      [
        'the role lost a permission the recheck names',
        new PermissionError('You no longer have permission for this action'),
        `You no longer have permission for this action. ${NOTHING}`,
        'denied',
      ],
      [
        'the token may publish only with its profile',
        new UploadError('This token is restricted to its upload profile.', 403),
        `This token is restricted to its upload profile. ${NOTHING}`,
        'denied',
      ],
      [
        'a source file is gone',
        new ArchiveError(
          'One or more source files are unavailable.',
          404,
          true
        ),
        `One or more source files are unavailable. ${NOTHING} Check that the files, folder and upload profile this call names still exist.`,
        'denied',
      ],
      [
        'the folder is gone',
        new HttpError(404, 'Folder not found.'),
        `Folder not found. ${NOTHING} Check that the files, folder and upload profile this call names still exist.`,
        'failure',
      ],
    ]

    it.each(refusals)(
      'says what to do when %s',
      async (_what, thrown, message, outcome) => {
        mocks[service].mockRejectedValue(thrown)
        const error = await refused(call(name, args))
        expect(error.message).toBe(message)
        expect(error.outcome).toBe(outcome)
        // No browser's advice, and no dash a model would stumble over.
        expect(error.message).not.toMatch(/Refresh|refreshed|[\u2013\u2014]/)
      }
    )

    it('passes on the refusal of the credential check as it is', async () => {
      const ended = new ToolError(
        'This connection was disconnected, lost the access this call needs, or the MCP server was turned off while the call was running. Nothing was created.',
        'denied'
      )
      mocks[service].mockRejectedValue(ended)
      expect(await refused(call(name, args))).toBe(ended)
    })

    it.each([
      new Error('database down'),
      new ArchiveError('Archive entry was not staged.', 500),
      new HttpError(503, 'Storage is unavailable.'),
    ])(
      "leaves Flare's own failure (%s) to the server to word and log",
      async (thrown) => {
        mocks[service].mockRejectedValue(thrown)
        await expect(call(name, args)).rejects.toBe(thrown)
      }
    )

    it('lets the account start another operation once one was refused', async () => {
      mocks[service].mockRejectedValueOnce(
        new ArchiveError('Expanded archive contents exceed 512 MiB.', 413)
      )
      await refused(call(name, args))
      await call(name, args)
    })
  })

  describe('one operation at a time', () => {
    /** A service that works until the test lets it finish. */
    function working() {
      let finish!: () => void
      const started = new Promise<void>((begun) => {
        mocks[service].mockImplementationOnce(async () => {
          begun()
          await new Promise<void>((resolve) => (finish = resolve))
          return service === 'extract'
            ? { folderId: 'folder-new', fileCount: 1, totalBytes: 1 }
            : {
                file: {
                  id: 'file-new',
                  name: 'bundle.zip',
                  urlPath: '/owner/bundle.zip',
                  folderId: null,
                },
                totalBytes: 1,
              }
        })
      })
      return { started, finish: () => finish() }
    }

    it('refuses a second call for the account while the first is working, and says to wait', async () => {
      const first = working()
      const running = call(name, args)
      await first.started
      // Either tool: the account has one operation, whatever it is.
      for (const [other, otherArgs] of [
        ['extract_archive', EXTRACT],
        ['create_archive', CREATE],
      ] as const)
        expect((await refused(call(other, otherArgs))).message).toBe(BUSY)
      expect(
        mocks.extract.mock.calls.length + mocks.create.mock.calls.length
      ).toBe(1)
      first.finish()
      await running
      // And is free again once it has finished.
      await call(name, args)
    })

    it('ends the operation with the MCP request that asked for it', async () => {
      const calling = new AbortController()
      let operation!: ArchiveOperation
      mocks[service].mockImplementationOnce(async (...received: unknown[]) => {
        operation = received.at(-1) as ArchiveOperation
        // As the services do: they stop where the signal says to.
        await new Promise((_, reject) =>
          operation.signal.addEventListener('abort', () =>
            reject(operation.signal.reason)
          )
        )
      })
      const running = call(
        name,
        args,
        context({
          request: new Request(`${ORIGIN}/api/mcp`, {
            method: 'POST',
            signal: calling.signal,
          }),
        })
      )
      await vi.waitFor(() => expect(operation).toBeDefined())
      expect(operation.signal.aborted).toBe(false)
      calling.abort()
      const error = await refused(running)
      expect(error.message).toBe(
        'Archive operation was cancelled. Nothing was created. Call again; if it runs out of time again, the files are too large to work on here.'
      )
      // The account's slot is free again.
      await call(name, args)
    })
  })

  it('states the limits of the service, and that a call can take two minutes', () => {
    const { description } = tool(name)
    expect(description).toMatch(/256 MB/)
    expect(description).toMatch(/512 MB/)
    expect(description).toMatch(/up to 2 minutes/)
    expect(description).toMatch(
      /one archive operation for an account at a time/
    )
    expect(description).toMatch(/private and never expires/)
    expect(description).toMatch(/nothing is created/)
    expect(description).not.toMatch(/\n/)
    expect(description).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('the limits the archive tools state', () => {
  it('are the number of entries an extraction takes, and of files an archive packs', () => {
    expect(tool('extract_archive').description).toMatch(
      /1,000 files and folders/
    )
    expect(tool('extract_archive').description).toMatch(
      /zip, tar, tar\.gz, tgz or gz/
    )
    expect(tool('create_archive').description).toMatch(/up to 100 of/)
    expect(tool('create_archive').description).toMatch(/zip or tar\.gz/)
  })
})

describe('export_account', () => {
  /** The row the tool stored for the URL it answered. */
  const row = () => {
    expect(mocks.createTransfer).toHaveBeenCalledOnce()
    return mocks.createTransfer.mock.calls[0][0].data as {
      kind: string
      userId: string
      credential: string
      secretHash: string
      expiresAt: Date
      fileId?: string
      options?: unknown
    }
  }

  it('takes no arguments, so it never exports the whole account for a call that asked for part of it', () => {
    const { input } = tool('export_account')
    expect(input.safeParse({}).success).toBe(true)
    expect(input.safeParse({ files: ['one'] }).success).toBe(false)
  })

  it('answers a one-time URL with the command that downloads the export', async () => {
    const before = Date.now()
    const answer = await call('export_account', {})
    expect(Object.keys(answer).sort()).toEqual([
      'curl',
      'download_url',
      'expires_at',
    ])
    const url = answer.download_url as string
    expect(url.startsWith(`${ORIGIN}/api/mcp/transfer/`)).toBe(true)
    expect(url.slice(`${ORIGIN}/api/mcp/transfer/`.length)).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    )
    expect(answer.curl).toBe(`curl -fsS -o flare-export.zip "${url}"`)
    // Fifteen minutes to start the download.
    const lifetime = new Date(answer.expires_at).getTime() - before
    expect(lifetime).toBeGreaterThan(14 * 60_000)
    expect(lifetime).toBeLessThanOrEqual(15 * 60_000 + 1000)
  })

  it('stores a row that names nothing but whose export it is', async () => {
    const answer = await call('export_account', {})
    const stored = row()
    expect(stored).toMatchObject({
      kind: 'export',
      userId: 'owner',
      credential: 'token:token-1',
    })
    expect(stored.fileId).toBeUndefined()
    expect(stored.options).toBeUndefined()
    expect(stored.expiresAt.toISOString()).toBe(answer.expires_at)
    // Only a digest of the secret is kept.
    const secret = (answer.download_url as string).split('/').pop()!
    expect(JSON.stringify(stored)).not.toContain(secret)
  })

  it('takes no argument that could say whose export, or what is in it', () => {
    const { input } = tool('export_account')
    expect(Object.keys(input.shape)).toEqual([])
  })

  it('stops at the number of export URLs one connection may have waiting', async () => {
    mocks.countTransfers.mockResolvedValue(MAX_OUTSTANDING_TRANSFERS)
    const error = await refused(call('export_account', {}))
    expect(error).toBeInstanceOf(TransferLimitError)
    expect(error.message).toBe(
      `This connection already has ${MAX_OUTSTANDING_TRANSFERS} export URLs waiting. Use one, or wait: one that was never used expires 15 minutes after it was made.`
    )
    expect(mocks.createTransfer).not.toHaveBeenCalled()
    // Counted on their own, apart from download links and upload URLs.
    expect(mocks.countTransfers).toHaveBeenCalledWith({
      where: { userId: 'owner', credential: 'token:token-1', kind: 'export' },
    })
  })

  it('never writes anything a shell would read into the command', async () => {
    for (const origin of [
      'https://flare.test/$(id)',
      'https://flare.test/`id`',
      'https://flare.test/"; rm -rf ~; "',
      'https://flare.test/!!',
      'https://flare.test/a b',
      'https://flare.test/\\',
    ]) {
      const error = await refused(
        call('export_account', {}, context({ origin }))
      )
      expect(error.message).toBe(
        'The address of this Flare instance holds characters that are not safe in a shell command. Ask its administrator to check the address it is served under.'
      )
    }
    expect(mocks.createTransfer).not.toHaveBeenCalled()
    // An address under a path is an address like any other.
    const answer = await call(
      'export_account',
      {},
      context({ origin: 'https://example.com/flare' })
    )
    expect(answer.curl).toMatch(
      /^curl -fsS -o flare-export\.zip "https:\/\/example\.com\/flare\/api\/mcp\/transfer\/[A-Za-z0-9_-]{43}"$/
    )
  })

  it('names the account as the audit target', async () => {
    const audit: AuditContext = {}
    await auditContext.run(audit, () => call('export_account', {}))
    expect(audit).toMatchObject({
      targetType: 'user',
      targetId: 'owner',
      targetName: 'Alex',
    })
  })

  it('says the export holds every file and link, can be large, and works once', () => {
    const { description } = tool('export_account')
    expect(description).toMatch(/every file and link/)
    expect(description).toMatch(/very large/)
    expect(description).toMatch(/one-time URL/)
    expect(description).toMatch(/within 15 minutes/)
    expect(description).toMatch(/`curl`/)
    expect(description).not.toMatch(/\n/)
    expect(description).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('the archive tools', () => {
  it('are the three the catalog lists, each answering structured content', () => {
    expect(archivesTools.map(({ name }) => name)).toEqual([
      'extract_archive',
      'create_archive',
      'export_account',
    ])
    for (const { name, blocksOnly } of archivesTools) {
      expect(TOOL_CATALOG).toHaveProperty(name)
      expect(blocksOnly).toBeUndefined()
    }
  })
})

describe('the last check on an archive call', () => {
  const connected = () =>
    principalOf({
      credential: 'agent',
      apiToken: undefined,
      agentConnection: {
        id: 'connection-1',
        scopes: ['files:read', 'files:content', 'files:upload'],
      },
    })
  const settings = (enabled: boolean) => {
    const value = structuredClone(DEFAULT_CONFIG)
    value.settings.general.mcp.enabled = enabled
    return value
  }
  const tokenRow = {
    id: 'token-1',
    scopes: ['mcp', 'files:read', 'files:content', 'files:upload'],
    revokedAt: null as Date | null,
    expiresAt: null as Date | null,
  }
  const connectionRow = {
    revokedAt: null as Date | null,
    scopes: ['files:read', 'files:content', 'files:upload'],
  }

  /** A transaction client holding the credential and the settings as they are now. */
  function transaction({
    token = tokenRow as Partial<typeof tokenRow> | null,
    connection = connectionRow as Partial<typeof connectionRow> | null,
    enabled = true,
  } = {}) {
    const raw = {
      $queryRaw: vi.fn(async () => []),
      apiToken: {
        findUnique: vi.fn(async () =>
          token ? { ...tokenRow, ...token } : null
        ),
      },
      agentConnection: {
        findUnique: vi.fn(async () =>
          connection ? { ...connectionRow, ...connection } : null
        ),
      },
      config: { findUnique: vi.fn(async () => ({ value: settings(enabled) })) },
    }
    return { tx: raw as unknown as Prisma.TransactionClient, raw }
  }
  /** What a transaction holds, where it differs from a credential in good standing. */
  type Held = NonNullable<Parameters<typeof transaction>[0]>
  const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
    mock.mock.invocationCallOrder[0]
  const ENDED =
    'This connection was disconnected, lost the access this call needs, or the MCP server was turned off while the call was running.'

  afterEach(() => vi.useRealTimers())

  it('is built for the account as it stands when the call starts', async () => {
    const principal = principalOf()
    const actor = await archiveActor(principal, 'extract_archive')
    expect(actor.user).toBe(principal.user)
    expect(actor.sessionVersion).toBe(4)
    expect(mocks.account).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'owner' },
      select: { sessionVersion: true },
    })
    // A later change of the session version is the services' to notice.
    mocks.account.mockResolvedValue({ sessionVersion: 5 })
    expect(actor.sessionVersion).toBe(4)
  })

  it('is refused for an account that is gone', async () => {
    mocks.account.mockResolvedValue(null)
    const error = await refused(archiveActor(principalOf(), 'extract_archive'))
    expect(error).toMatchObject({
      outcome: 'denied',
      message: 'This account no longer exists.',
    })
  })

  describe.each(['extract_archive', 'create_archive'] as const)(
    'for %s by a named token',
    (name) => {
      const check = async () =>
        (await archiveActor(principalOf(), name)).authorize!

      it("holds the token's row, then reads the token and the settings, all through the transaction", async () => {
        const authorize = await check()
        const { tx, raw } = transaction()
        mocks.account.mockClear()
        await expect(authorize(tx)).resolves.toBeUndefined()
        const [statement, id] = raw.$queryRaw.mock.calls[0] as unknown as [
          string[],
          string,
        ]
        // The lock an upload takes on its token, held to the commit.
        expect(statement.join('?')).toBe(
          'SELECT "id" FROM "ApiToken" WHERE "id" = ? FOR SHARE'
        )
        expect(id).toBe('token-1')
        expect(raw.$queryRaw).toHaveBeenCalledOnce()
        expect(raw.apiToken.findUnique).toHaveBeenCalledExactlyOnceWith({
          where: { id: 'token-1' },
        })
        expect(raw.config.findUnique).toHaveBeenCalledOnce()
        expect(order(raw.$queryRaw)).toBeLessThan(
          order(raw.apiToken.findUnique)
        )
        expect(order(raw.apiToken.findUnique)).toBeLessThan(
          order(raw.config.findUnique)
        )
        // A token is not a connection, and nothing outside is asked.
        expect(raw.agentConnection.findUnique).not.toHaveBeenCalled()
        expect(mocks.account).not.toHaveBeenCalled()
      })

      it.each<[string, Held, boolean]>([
        ['the MCP server was turned off', {}, false],
        ['the token was revoked', { token: { revokedAt: new Date() } }, true],
        [
          'the token has expired',
          { token: { expiresAt: new Date(Date.now() - 1) } },
          true,
        ],
        ['the token was deleted', { token: null }, true],
        [
          'the token no longer carries Agent access',
          {
            token: { scopes: ['files:read', 'files:content', 'files:upload'] },
          },
          true,
        ],
        [
          'the token lost the upload scope',
          { token: { scopes: ['mcp', 'files:read', 'files:content'] } },
          true,
        ],
        [
          'the token lost the scope for reading contents',
          { token: { scopes: ['mcp', 'files:read', 'files:upload'] } },
          true,
        ],
      ])('refuses when %s meanwhile', async (_what, held, enabled) => {
        const authorize = await check()
        const { tx } = transaction({ ...held, enabled })
        const error = await refused(authorize(tx))
        expect(error).toMatchObject({
          outcome: 'denied',
          message: `${ENDED} Nothing was created.`,
        })
      })
    }
  )

  describe.each(['extract_archive', 'create_archive'] as const)(
    'for %s by an agent that signed in',
    (name) => {
      const check = async () =>
        (await archiveActor(connected(), name)).authorize!

      it("holds the connection's row before reading it, and never reads a token", async () => {
        const authorize = await check()
        const { tx, raw } = transaction()
        await expect(authorize(tx)).resolves.toBeUndefined()
        const [statement, id] = raw.$queryRaw.mock.calls[0] as unknown as [
          string[],
          string,
        ]
        expect(statement.join('?')).toBe(
          'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR SHARE'
        )
        expect(id).toBe('connection-1')
        expect(raw.$queryRaw).toHaveBeenCalledOnce()
        expect(raw.agentConnection.findUnique).toHaveBeenCalledExactlyOnceWith({
          where: { id: 'connection-1' },
          select: { revokedAt: true, scopes: true, createdAt: true },
        })
        expect(order(raw.$queryRaw)).toBeLessThan(
          order(raw.agentConnection.findUnique)
        )
        expect(raw.config.findUnique).toHaveBeenCalledOnce()
        expect(raw.apiToken.findUnique).not.toHaveBeenCalled()
      })

      it.each<[string, Held, boolean]>([
        ['the MCP server was turned off', {}, false],
        [
          'the agent was disconnected',
          { connection: { revokedAt: new Date() } },
          true,
        ],
        ['the connection was removed', { connection: null }, true],
        [
          'its permissions lost uploading',
          { connection: { scopes: ['files:read', 'files:content'] } },
          true,
        ],
        [
          'its permissions lost reading contents',
          { connection: { scopes: ['files:read', 'files:upload'] } },
          true,
        ],
        ['its permissions were emptied', { connection: { scopes: [] } }, true],
      ])('refuses when %s meanwhile', async (_what, held, enabled) => {
        const authorize = await check()
        const { tx } = transaction({ ...held, enabled })
        const error = await refused(authorize(tx))
        expect(error).toMatchObject({
          outcome: 'denied',
          message: `${ENDED} Nothing was created.`,
        })
      })
    }
  )

  it('asks a read for what reading needs, and promises nothing about what was created', async () => {
    const { authorize } = await archiveActor(connected(), 'read_file')
    // Reading contents is all read_file needs: uploading is not asked for.
    const reading = transaction({ connection: { scopes: ['files:content'] } })
    await expect(authorize!(reading.tx)).resolves.toBeUndefined()
    const none = transaction({ connection: { scopes: ['files:upload'] } })
    const error = await refused(authorize!(none.tx))
    expect(error.message).toBe(ENDED)
  })

  describe('credentialHolds', () => {
    it('answers for the scopes it is asked about, with the marker for a token', async () => {
      const principal = principalOf()
      expect(
        await credentialHolds(transaction().tx, principal, ['files:upload'])
      ).toBe(true)
      expect(
        await credentialHolds(transaction().tx, principal, ['files:delete'])
      ).toBe(false)
      expect(await credentialHolds(transaction().tx, principal, [])).toBe(true)
      expect(
        await credentialHolds(
          transaction({ token: { scopes: ['files:upload'] } }).tx,
          principal,
          []
        )
      ).toBe(false)
    })

    it('takes no lock for a token itself: its caller holds the row', async () => {
      const { tx, raw } = transaction()
      await credentialHolds(tx, principalOf(), ['files:upload'])
      expect(raw.$queryRaw).not.toHaveBeenCalled()
    })

    it('does not read the settings for a credential that already fails', async () => {
      const { tx, raw } = transaction({ token: { revokedAt: new Date() } })
      expect(await credentialHolds(tx, principalOf(), [])).toBe(false)
      expect(raw.config.findUnique).not.toHaveBeenCalled()
    })

    it('refuses a principal with neither a token nor a connection', async () => {
      const { tx, raw } = transaction()
      const nobody = principalOf({ credential: 'session', apiToken: undefined })
      expect(await credentialHolds(tx, nobody, [])).toBe(false)
      expect(raw.apiToken.findUnique).not.toHaveBeenCalled()
      expect(raw.agentConnection.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('stillAllowed', () => {
    const EVERYONE = {
      id: 'everyone',
      name: 'Everyone',
      position: 0,
      systemKey: 'everyone',
      permissions: ['files.read'],
    }
    /** A transaction that also holds the account's roles as they are now. */
    function saving(held: Held & { permissions?: string[] } = {}) {
      const { tx, raw } = transaction(held)
      const roles = {
        user: {
          findUnique: vi.fn(async () => ({
            roles: [
              {
                id: 'role-1',
                name: 'Members',
                position: 1,
                systemKey: null,
                permissions: held.permissions ?? [
                  'profile.update',
                  'files.delete',
                ],
              },
            ],
          })),
        },
        role: { findUnique: vi.fn(async () => EVERYONE) },
      }
      Object.assign(raw, roles)
      return { tx, raw: raw as typeof raw & typeof roles }
    }
    const TOOL = { scopes: ['files:upload'], permissions: ['profile.update'] }
    const EFFECT = { scopes: ['files:content'], permissions: ['files.delete'] }
    const needs = [TOOL, EFFECT] as unknown as Parameters<
      typeof stillAllowed
    >[2]

    it('passes while the credential, the server and the role hold everything the call leaned on', async () => {
      for (const principal of [principalOf(), connected()])
        await expect(
          stillAllowed(saving().tx, principal, needs)
        ).resolves.toBeUndefined()
    })

    it("takes a token's row before it reads it, and reads the role last", async () => {
      const { tx, raw } = saving()
      await stillAllowed(tx, principalOf(), needs)
      expect(raw.$queryRaw).toHaveBeenCalledOnce()
      const [statement, id] = raw.$queryRaw.mock.calls[0] as unknown as [
        string[],
        string,
      ]
      expect(statement.join('?')).toBe(
        'SELECT "id" FROM "ApiToken" WHERE "id" = ? FOR SHARE'
      )
      expect(id).toBe('token-1')
      expect(order(raw.$queryRaw)).toBeLessThan(order(raw.apiToken.findUnique))
      expect(order(raw.apiToken.findUnique)).toBeLessThan(
        order(raw.user.findUnique)
      )
    })

    it.each<[string, Held]>([
      ['the token was revoked', { token: { revokedAt: new Date() } }],
      ['the token is gone', { token: null }],
      [
        'the token lost a scope of the tool',
        { token: { scopes: ['mcp', 'files:content'] } },
      ],
      [
        'the token lost a scope of an effect',
        { token: { scopes: ['mcp', 'files:upload'] } },
      ],
      [
        'the token lost the MCP marker',
        { token: { scopes: ['files:upload', 'files:content'] } },
      ],
      ['the MCP server was turned off', { enabled: false }],
    ])('refuses a token when %s, as a denial', async (_what, held) => {
      const error = await refused(
        stillAllowed(saving(held).tx, principalOf(), needs)
      )
      expect(error.message).toBe(ENDED)
      expect(error.outcome).toBe('denied')
    })

    it.each<[string, Held]>([
      ['it was disconnected', { connection: { revokedAt: new Date() } }],
      ['it is gone', { connection: null }],
      [
        'Edit permissions took a scope away',
        { connection: { scopes: ['files:upload'] } },
      ],
      ['the MCP server was turned off', { enabled: false }],
    ])('refuses a connection when %s', async (_what, held) => {
      const error = await refused(
        stillAllowed(saving(held).tx, connected(), needs)
      )
      expect(error.message).toBe(ENDED)
    })

    it('refuses when the role stopped holding a permission, naming every one that went', async () => {
      const one = await refused(
        stillAllowed(
          saving({ permissions: ['profile.update'] }).tx,
          principalOf(),
          needs
        )
      )
      expect(one.message).toBe(
        "The account's role stopped holding files.delete while the call was running. An administrator can change that under Roles."
      )
      expect(one.outcome).toBe('denied')
      const both = await refused(
        stillAllowed(saving({ permissions: [] }).tx, principalOf(), needs)
      )
      expect(both.message).toContain('profile.update, files.delete')
    })

    it('counts what the role everyone holds gives', async () => {
      const read = [
        { scopes: [], permissions: ['files.read'] },
      ] as unknown as typeof needs
      await expect(
        stillAllowed(saving({ permissions: [] }).tx, principalOf(), read)
      ).resolves.toBeUndefined()
    })
  })
})
