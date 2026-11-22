import { compare } from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { HttpError } from '@/lib/http/errors'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import {
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from '@/lib/mcp/tool'
import { uploadsTools } from '@/lib/mcp/tools/uploads'
import { MAX_OUTSTANDING_TRANSFERS } from '@/lib/mcp/transfer'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'
import type { FixedUpload } from '@/lib/uploads/direct'

const mocks = vi.hoisted(() => ({
  directUpload: vi.fn(),
  consume: vi.fn(),
  folders: vi.fn(),
  tags: vi.fn(),
  profiles: vi.fn(),
  account: vi.fn(),
  createTransfer: vi.fn(),
  countTransfers: vi.fn(),
  quotas: { enabled: false, default: { value: 10, unit: 'MB' } },
}))
vi.mock('@/lib/uploads/direct', () => ({ directUpload: mocks.directUpload }))
vi.mock('@/lib/security/rate-limit', () => ({
  uploadLimiter: { consume: mocks.consume, points: 30 },
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.account },
    uploadProfile: {
      findMany: mocks.profiles,
      findFirst: async ({ where }: { where: { id: string } }) =>
        (await mocks.profiles()).find(
          (profile: { id: string }) => profile.id === where.id
        ) ?? null,
    },
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
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: { published: { sharing: { defaultStyle: 'framed' } } },
      general: {
        storage: {
          maxUploadSize: { value: 100, unit: 'MB' },
          quotas: mocks.quotas,
        },
      },
    },
  }),
}))
vi.mock('@/lib/files/delivery', () => ({ findFile: vi.fn() }))
vi.mock('@/lib/folders/service', () => ({
  listFolders: mocks.folders,
  validateOwnedFolderId: async (_user: string, id: string | null) => id,
}))
vi.mock('@/lib/tags/manage', () => ({ listTags: mocks.tags }))
vi.mock('@/lib/tags/service', () => ({
  validateOwnedTagIds: async (_user: string, ids: string[]) => ids,
}))

const ORIGIN = 'https://flare.test'
const KB = 1024
// A one-pixel PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const user: AuthenticatedUser = {
  id: 'owner',
  storageUsed: 0,
  urlId: 'owner',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  credential: 'token',
  apiToken: { id: 'token-1', scopes: ['mcp', 'files:upload'], profileId: null },
}

function context(
  overrides: { user?: Partial<AuthenticatedUser>; origin?: string } = {}
): ToolContext {
  const account = { ...user, ...overrides.user }
  const principal: AgentPrincipal = {
    user: account,
    name: 'Alex',
    scopes: ['files:upload'],
    credentialKey: 'token:token-1',
    can: (permission) => hasPermission(account, permission),
  }
  return {
    principal,
    request: new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }),
    origin: overrides.origin ?? ORIGIN,
    allows: () => true,
    requireEffect: () => {},
  }
}

const tool = (name: string): ToolDefinition => {
  const found = uploadsTools.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`No tool called ${name}`)
  return found as unknown as ToolDefinition
}

/** The answer of any of the three tools, loosely, for the assertions. */
type Answer = {
  file: Record<string, unknown>
  upload_url: string
  expires_at: string
  max_file_bytes: number
  curl: string
}

/** One call as the server makes it: arguments through the input schema, the answer through the output schema. */
async function call(
  name: string,
  args: Record<string, unknown>,
  toolContext = context()
): Promise<Answer> {
  const { input, output, run } = tool(name)
  const answer = await run(input.parse(args), toolContext)
  // Strict, so a field the schema does not declare fails here as in a client.
  return output.strict().parse(answer.structured) as unknown as Answer
}

/** What `directUpload` was handed on its only call, with the form read back. */
async function received() {
  expect(mocks.directUpload).toHaveBeenCalledOnce()
  const [request, account, fixed] = mocks.directUpload.mock.calls[0] as [
    Request,
    AuthenticatedUser,
    FixedUpload,
  ]
  const form = await request.clone().formData()
  const file = form.get('file') as File
  return {
    request,
    account,
    fixed,
    fields: [...form.keys()],
    file,
    bytes: Buffer.from(await file.arrayBuffer()),
  }
}

const options = async () => (await received()).fixed.options

beforeEach(() => {
  vi.clearAllMocks()
  mocks.quotas.enabled = false
  mocks.consume.mockResolvedValue(undefined)
  mocks.folders.mockResolvedValue([
    { id: 'folder-work', name: 'Work', parentId: null },
    { id: 'folder-reports', name: 'Reports', parentId: 'folder-work' },
  ])
  mocks.tags.mockResolvedValue([
    { id: 'tag-invoice', name: 'Invoice' },
    { id: 'tag-2026', name: '2026' },
  ])
  const updatedAt = new Date('2026-11-01T00:00:00.000Z')
  mocks.profiles.mockResolvedValue([
    { id: 'profile-shots', name: 'Screenshots', options: {}, updatedAt },
    { id: 'profile-docs', name: 'Docs', options: {}, updatedAt },
  ])
  mocks.account.mockResolvedValue({
    randomizeFileUrls: false,
    defaultFileExpiration: 'DISABLED',
    defaultFileExpirationAction: 'DELETE',
    defaultUploadProfileId: null,
  })
  mocks.countTransfers.mockResolvedValue(0)
  mocks.createTransfer.mockResolvedValue({})
  mocks.directUpload.mockImplementation(async (request: Request) => {
    const file = (await request.clone().formData()).get('file') as File
    return {
      id: 'file-1',
      url: `${ORIGIN}/owner/${file.name}`,
      pageUrl: `${ORIGIN}/owner/${file.name}`,
      rawUrl: `${ORIGIN}/api/files/owner/${file.name}`,
      downloadUrl: `${ORIGIN}/api/files/file-1/download`,
      copyText: `${ORIGIN}/owner/${file.name}`,
      name: file.name,
      size: file.size,
      type: file.type,
    }
  })
})

describe('upload_file', () => {
  it('sends the text as one multipart file through the shared upload path', async () => {
    const toolContext = context()
    const answer = await call(
      'upload_file',
      { filename: 'notes.md', text: '# Notes\n\nKept short. ✓' },
      toolContext
    )
    const { request, account, fixed, fields, file, bytes } = await received()
    expect(request.url).toBe('http://flare.internal/api/files')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toMatch(
      /^multipart\/form-data; boundary=/
    )
    // Options travel beside the request, never as form fields or headers.
    expect(fields).toEqual(['file'])
    expect(request.headers.get('x-upload-profile')).toBeNull()
    expect(request.headers.get('x-flare-paste')).toBeNull()
    expect(file.name).toBe('notes.md')
    expect(file.type).toBe('text/plain')
    expect(bytes.toString('utf8')).toBe('# Notes\n\nKept short. ✓')
    // The account the credential acts as, not a copy that could drift from it.
    expect(account).toBe(toolContext.principal.user)
    expect(fixed).toEqual({
      options: {},
      filename: 'notes.md',
      isPaste: undefined,
    })
    expect(answer).toEqual({
      file: {
        id: 'file-1',
        name: 'notes.md',
        type: 'text/plain',
        size_bytes: bytes.length,
        url: `${ORIGIN}/owner/notes.md`,
        raw_url: `${ORIGIN}/api/files/owner/notes.md`,
        download_url: `${ORIGIN}/api/files/file-1/download`,
      },
    })
  })

  it('decodes base64 and stores it as what its bytes are', async () => {
    await call('upload_file', { filename: 'pixel.png', base64: PNG })
    const { file, bytes } = await received()
    expect(file.name).toBe('pixel.png')
    expect(file.type).toBe('image/png')
    expect(bytes.equals(Buffer.from(PNG, 'base64'))).toBe(true)
  })

  it('accepts base64 with line breaks and without padding', async () => {
    const wrapped = `${PNG.slice(0, 40)}\n${PNG.slice(40).replace(/=+$/, '')}`
    await call('upload_file', { filename: 'pixel.png', base64: wrapped })
    expect((await received()).bytes.equals(Buffer.from(PNG, 'base64'))).toBe(
      true
    )
  })

  it('falls back to a generic type for bytes it does not recognize', async () => {
    await call('upload_file', {
      filename: 'data.bin',
      base64: Buffer.from([1, 2, 3, 4, 5]).toString('base64'),
    })
    expect((await received()).file.type).toBe('application/octet-stream')
  })

  it('uses the type the caller names, in lower case', async () => {
    await call('upload_file', {
      filename: 'logo.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      mime_type: 'Image/SVG+XML',
    })
    expect((await received()).file.type).toBe('image/svg+xml')
  })

  it('stores text recognized as another text format under that type', async () => {
    await call('upload_file', {
      filename: 'feed.xml',
      text: '<?xml version="1.0"?><feed/>',
    })
    expect((await received()).file.type).toBe('application/xml')
  })

  it('keeps prose that begins like a binary format as text', async () => {
    await call('upload_file', {
      filename: 'gifs.txt',
      text: 'GIF89a is how every GIF file begins.',
    })
    expect((await received()).file.type).toBe('text/plain')
  })

  it('names the file by its last path component, exactly as given', async () => {
    await call('upload_file', {
      filename: '  reports/2026/say "hi"\u0007.txt ',
      text: 'x',
    })
    const { fixed } = await received()
    // The multipart header escapes the quotes; the fixed name does not.
    expect(fixed.filename).toBe('say "hi".txt')
  })

  it.each([['..'], ['folder/'], ['   ']])(
    'refuses %j as a filename',
    async (filename) => {
      await expect(
        call('upload_file', { filename, text: 'x' })
      ).rejects.toThrow(
        new ToolError('`filename` must be a file name, such as notes.txt.')
      )
      expect(mocks.directUpload).not.toHaveBeenCalled()
    }
  )

  it('takes text up to 256 KB, counted in bytes', async () => {
    await call('upload_file', {
      filename: 'full.txt',
      text: 'x'.repeat(256 * KB),
    })
    expect((await received()).bytes.length).toBe(256 * KB)
    mocks.directUpload.mockClear()
    await expect(
      call('upload_file', {
        filename: 'over.txt',
        text: 'x'.repeat(256 * KB + 1),
      })
    ).rejects.toThrow(
      new ToolError(
        '`text` is 262145 bytes; this tool takes up to 262144 (256 KB). For anything larger, call create_upload_url and run the curl command it returns.'
      )
    )
    // Fewer characters than the limit, more bytes.
    await expect(
      call('upload_file', { filename: 'wide.txt', text: '✓'.repeat(100 * KB) })
    ).rejects.toThrow(
      /`text` is 307200 bytes; this tool takes up to 262144 \(256 KB\)/
    )
    expect(mocks.directUpload).not.toHaveBeenCalled()
    expect(mocks.consume).toHaveBeenCalledOnce()
  })

  it('takes base64 up to 64 KB once decoded', async () => {
    await call('upload_file', {
      filename: 'full.bin',
      base64: Buffer.alloc(64 * KB, 7).toString('base64'),
    })
    expect((await received()).bytes.length).toBe(64 * KB)
    mocks.directUpload.mockClear()
    await expect(
      call('upload_file', {
        filename: 'over.bin',
        base64: Buffer.alloc(64 * KB + 1, 7).toString('base64'),
      })
    ).rejects.toThrow(
      new ToolError(
        '`base64` is 65537 bytes; this tool takes up to 65536 (64 KB). For anything larger, call create_upload_url and run the curl command it returns.'
      )
    )
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it.each([['not base64!'], ['abc*def='], ['A'], ['AA==AA==']])(
    'refuses %j as base64',
    async (base64) => {
      await expect(
        call('upload_file', { filename: 'data.bin', base64 })
      ).rejects.toThrow(/^`base64` is not valid base64\./)
      expect(mocks.directUpload).not.toHaveBeenCalled()
    }
  )

  it('refuses a megabyte of padding at once, without scanning it again and again', async () => {
    const started = performance.now()
    await expect(
      call('upload_file', {
        filename: 'data.bin',
        base64: `${'='.repeat(1024 * KB)}A`,
      })
    ).rejects.toThrow(/^`base64` is not valid base64\./)
    await expect(
      call('upload_file', {
        filename: 'data.bin',
        base64: `${'A'.repeat(1024 * KB)}${'='.repeat(1024 * KB)}`,
      })
    ).rejects.toThrow(/^`base64` is 786432 bytes; this tool takes up to 65536/)
    // A pattern that backtracks over the padding takes minutes here.
    expect(performance.now() - started).toBeLessThan(2000)
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it('needs exactly one of text and base64', async () => {
    await expect(
      call('upload_file', { filename: 'both.txt', text: 'x', base64: 'eA==' })
    ).rejects.toThrow(
      new ToolError('Give the contents as `text` or as `base64`, not both.')
    )
    await expect(call('upload_file', { filename: 'none.txt' })).rejects.toThrow(
      new ToolError(
        'Give the contents as `text`, or as `base64` for binary data.'
      )
    )
    // An empty string for the one not used is how some clients leave it out.
    await call('upload_file', { filename: 'one.txt', text: 'x', base64: '' })
    expect((await received()).bytes.toString()).toBe('x')
  })

  it('refuses a type that is not a bare MIME type before anything runs', async () => {
    for (const mime_type of [
      'text/plain; charset=utf-8',
      'image/png"; rm -rf ~; "',
      'image/$(id)',
      'png',
    ])
      await expect(
        call('upload_file', { filename: 'a.txt', text: 'x', mime_type })
      ).rejects.toThrow(/A MIME type looks like image\/png/)
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it('counts against the upload limit of its credential', async () => {
    await call('upload_file', { filename: 'a.txt', text: 'x' })
    expect(mocks.consume).toHaveBeenCalledExactlyOnceWith('token:token-1')
    mocks.directUpload.mockClear()
    mocks.consume.mockRejectedValue({ msBeforeNext: 30_000 })
    const refusal = await call('upload_file', {
      filename: 'b.txt',
      text: 'x',
    }).catch((error) => error)
    expect(refusal).toBeInstanceOf(ToolError)
    expect(refusal.message).toBe(
      'Too many uploads: this connection may make 30 a minute. Wait a minute, then continue.'
    )
    expect(refusal.outcome).toBe('denied')
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it('does not spend the upload limit on a call its arguments refuse', async () => {
    await expect(
      call('upload_file', { filename: 'a.txt', text: 'x', folder: 'Nowhere' })
    ).rejects.toThrow(ToolError)
    expect(mocks.consume).not.toHaveBeenCalled()
  })

  it('lets the upload code answer for what it refuses', async () => {
    const refused = new HttpError(
      403,
      'Your role cannot organize uploads into folders.'
    )
    mocks.directUpload.mockRejectedValue(refused)
    await expect(
      call('upload_file', { filename: 'a.txt', text: 'x', folder: 'Work' })
    ).rejects.toBe(refused)
  })

  it('ends the upload with the call that asked for it', async () => {
    const controller = new AbortController()
    const toolContext = {
      ...context(),
      request: new Request(`${ORIGIN}/api/mcp`, {
        method: 'POST',
        signal: controller.signal,
      }),
    }
    await call('upload_file', { filename: 'a.txt', text: 'x' }, toolContext)
    const { request } = await received()
    expect(request.signal.aborted).toBe(false)
    controller.abort()
    expect(request.signal.aborted).toBe(true)
  })
})

describe('upload options', () => {
  const upload = (args: Record<string, unknown>) =>
    call('upload_file', { filename: 'a.txt', text: 'x', ...args })

  it('leaves every option the caller did not give unset', async () => {
    await upload({})
    expect(await options()).toEqual({})
  })

  it('treats empty values as not given', async () => {
    await upload({ password: '', folder: '', tags: [], profile: '' })
    expect(await options()).toEqual({})
  })

  it('maps visibility, password and the expiry action', async () => {
    await upload({
      visibility: 'private',
      password: 'correct horse',
      expiry_action: 'make_private',
    })
    expect(await options()).toEqual({
      visibility: 'PRIVATE',
      password: 'correct horse',
      expiryAction: 'SET_PRIVATE',
    })
    mocks.directUpload.mockClear()
    await upload({ visibility: 'public', expiry_action: 'delete' })
    expect(await options()).toEqual({
      visibility: 'PUBLIC',
      expiryAction: 'DELETE',
    })
  })

  it.each([
    ['hour', 'HOUR'],
    ['day', 'DAY'],
    ['week', 'WEEK'],
    ['month', 'MONTH'],
    ['never', 'DISABLED'],
  ])('maps expires_in %s to %s', async (expires_in, expiration) => {
    await upload({ expires_in })
    expect(await options()).toEqual({ expiration })
  })

  it('passes an exact expiry time through', async () => {
    await upload({ expires_at: '2030-01-02T03:04:05+02:00' })
    expect(await options()).toEqual({ expiresAt: '2030-01-02T03:04:05+02:00' })
  })

  it('refuses both expiry forms together, and a time without an offset', async () => {
    await expect(
      upload({ expires_at: '2030-01-02T03:04:05Z', expires_in: 'day' })
    ).rejects.toThrow(
      new ToolError('Give `expires_at` or `expires_in`, not both.')
    )
    for (const expires_at of ['2030-01-02', '2030-01-02T03:04:05', 'tomorrow'])
      await expect(upload({ expires_at })).rejects.toThrow(
        new ToolError(
          '`expires_at` must be an ISO 8601 time with an offset, such as 2026-12-01T09:00:00Z.'
        )
      )
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it('finds the folder by path, by name or by ID', async () => {
    for (const folder of [
      'Work/Reports',
      '/work/reports/',
      'Reports',
      'folder-reports',
    ]) {
      mocks.directUpload.mockClear()
      await upload({ folder })
      expect(await options()).toEqual({ folderId: 'folder-reports' })
    }
    expect(mocks.folders).toHaveBeenCalledWith('owner')
  })

  it('reads "none" as no folder, which is where uploads go anyway', async () => {
    await upload({ folder: 'None' })
    expect(await options()).toEqual({})
    expect(mocks.folders).not.toHaveBeenCalled()
  })

  it('refuses a folder the account does not have', async () => {
    await expect(upload({ folder: 'Private/Elsewhere' })).rejects.toThrow(
      new ToolError(
        'No folder matches "Private/Elsewhere". Call list_folders to see the folders and their paths.'
      )
    )
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it('finds tags by name or by ID, each once', async () => {
    await upload({ tags: ['invoice', 'tag-2026', 'Invoice'] })
    expect(await options()).toEqual({ tagIds: ['tag-invoice', 'tag-2026'] })
    // The account's tags are read once, however many are named.
    expect(mocks.tags).toHaveBeenCalledExactlyOnceWith('owner')
  })

  it('refuses a tag the account does not have, and more than 20', async () => {
    await expect(upload({ tags: ['Invoice', 'Missing'] })).rejects.toThrow(
      new ToolError('No tag matches "Missing". Call list_tags to see the tags.')
    )
    await expect(
      upload({ tags: Array.from({ length: 21 }, () => 'Invoice') })
    ).rejects.toThrow()
    expect(mocks.directUpload).not.toHaveBeenCalled()
  })

  it('finds the upload profile by ID or by name', async () => {
    for (const profile of ['profile-docs', 'Docs', ' docs ']) {
      mocks.directUpload.mockClear()
      await upload({ profile })
      expect(await options()).toEqual({ profileId: 'profile-docs' })
    }
    expect(mocks.profiles).toHaveBeenCalledWith({
      where: { userId: 'owner' },
      select: { id: true, name: true },
    })
  })

  it('reads "none" as uploading without a profile', async () => {
    await upload({ profile: 'none' })
    expect(await options()).toEqual({ profileId: null })
  })

  it('refuses a profile it cannot tell apart or does not find', async () => {
    mocks.profiles.mockResolvedValue([
      { id: 'p1', name: 'Docs' },
      { id: 'p2', name: 'docs' },
    ])
    await expect(upload({ profile: 'DOCS' })).rejects.toThrow(
      new ToolError(
        'Several upload profiles match "DOCS": Docs, docs. Use the exact name or the profile ID.'
      )
    )
    // The exact name still picks one.
    await upload({ profile: 'docs' })
    expect(await options()).toEqual({ profileId: 'p2' })
    await expect(upload({ profile: 'Missing' })).rejects.toThrow(
      new ToolError(
        'No upload profile matches "Missing". Call get_account to see the upload profiles.'
      )
    )
  })

  it('maps every option at once', async () => {
    await upload({
      visibility: 'public',
      password: 'correct horse',
      expires_in: 'week',
      expiry_action: 'delete',
      folder: 'Work',
      tags: ['2026'],
      profile: 'Screenshots',
    })
    expect(await options()).toEqual({
      visibility: 'PUBLIC',
      password: 'correct horse',
      expiration: 'WEEK',
      expiryAction: 'DELETE',
      folderId: 'folder-work',
      tagIds: ['tag-2026'],
      profileId: 'profile-shots',
    })
  })
})

describe('create_paste', () => {
  it('uploads the text as a paste called paste.txt', async () => {
    const toolContext = context()
    const answer = await call(
      'create_paste',
      { content: 'SELECT 1;' },
      toolContext
    )
    const { fixed, file, bytes, fields, account } = await received()
    expect(fields).toEqual(['file'])
    expect(file.name).toBe('paste.txt')
    expect(file.type).toBe('text/plain')
    expect(bytes.toString()).toBe('SELECT 1;')
    expect(account).toBe(toolContext.principal.user)
    expect(fixed).toEqual({ options: {}, filename: 'paste.txt', isPaste: true })
    expect(answer.file).toMatchObject({
      id: 'file-1',
      name: 'paste.txt',
      type: 'text/plain',
      size_bytes: 9,
    })
  })

  it('takes a name and the same options as an upload', async () => {
    await call('create_paste', {
      content: 'print("hi")',
      filename: 'snippets/hello.py',
      visibility: 'private',
      expires_in: 'day',
      folder: 'Work',
      tags: ['Invoice'],
      profile: 'Docs',
    })
    const { fixed, file } = await received()
    expect(file.name).toBe('hello.py')
    expect(fixed).toEqual({
      filename: 'hello.py',
      isPaste: true,
      options: {
        visibility: 'PRIVATE',
        expiration: 'DAY',
        folderId: 'folder-work',
        tagIds: ['tag-invoice'],
        profileId: 'profile-docs',
      },
    })
  })

  it('refuses blank text and more than 256 KB', async () => {
    await expect(call('create_paste', { content: ' \n\t ' })).rejects.toThrow(
      new ToolError('`content` is empty. Give the text or code to share.')
    )
    await expect(call('create_paste', { content: '' })).rejects.toThrow()
    await expect(
      call('create_paste', { content: 'x'.repeat(256 * KB + 1) })
    ).rejects.toThrow(
      /`content` is 262145 bytes; this tool takes up to 262144 \(256 KB\)/
    )
    expect(mocks.directUpload).not.toHaveBeenCalled()
    expect(mocks.consume).not.toHaveBeenCalled()
  })

  it('counts against the upload limit too', async () => {
    await call('create_paste', { content: 'x' })
    expect(mocks.consume).toHaveBeenCalledExactlyOnceWith('token:token-1')
  })
})

describe('create_upload_url', () => {
  /** The row the URL was stored as. */
  const stored = () => {
    expect(mocks.createTransfer).toHaveBeenCalledOnce()
    return mocks.createTransfer.mock.calls[0][0].data as {
      userId: string
      credential: string
      kind: string
      secretHash: string
      expiresAt: Date
      options: { filename?: string; options: object; passwordHash?: string }
    }
  }

  it('answers a one-time URL with the command that uses it', async () => {
    const before = Date.now()
    const answer = await call('create_upload_url', {})
    expect(answer.upload_url).toMatch(
      /^https:\/\/flare\.test\/api\/mcp\/transfer\/[A-Za-z0-9_-]{43}$/
    )
    expect(answer.curl).toBe(
      `curl -sS -F "file=@/path/to/file" "${answer.upload_url}"`
    )
    expect(answer.max_file_bytes).toBe(100 * KB * KB)
    const row = stored()
    expect(row).toMatchObject({
      userId: 'owner',
      credential: 'token:token-1',
      kind: 'upload',
      options: { options: {} },
    })
    expect(answer.expires_at).toBe(row.expiresAt.toISOString())
    const minutes = (row.expiresAt.getTime() - before) / 60_000
    expect(minutes).toBeGreaterThanOrEqual(15)
    expect(minutes).toBeLessThan(15.1)
    // The URL carries the secret; the row keeps only its digest.
    expect(JSON.stringify(row)).not.toContain(
      String(answer.upload_url).split('/').pop()
    )
    // Nothing is uploaded yet, so nothing is counted or published.
    expect(mocks.directUpload).not.toHaveBeenCalled()
    expect(mocks.consume).not.toHaveBeenCalled()
  })

  /**
   * The eight settings an upload uses, as an account without defaults of its
   * own resolves them. An expiry is kept as a length of time, so no absolute
   * time is among them unless the caller stated one.
   */
  const DEFAULTS = {
    visibility: 'PUBLIC',
    expiration: 'DISABLED',
    expiryAction: 'DELETE',
    randomizeFileUrls: false,
    shareStyle: 'framed',
    tagIds: [],
    profileId: null,
    folderId: null,
  }

  it('fixes the name and every option in the row', async () => {
    await call('create_upload_url', {
      filename: 'backups/site "final".zip',
      visibility: 'private',
      expires_at: '2030-01-02T03:04:05Z',
      expiry_action: 'make_private',
      folder: 'Work/Reports',
      tags: ['Invoice', '2026'],
      profile: 'Docs',
    })
    expect(stored().options).toEqual({
      filename: 'site "final".zip',
      options: {
        ...DEFAULTS,
        visibility: 'PRIVATE',
        expiresAt: '2030-01-02T03:04:05Z',
        expiryAction: 'SET_PRIVATE',
        folderId: 'folder-reports',
        tagIds: ['tag-invoice', 'tag-2026'],
        profileId: 'profile-docs',
      },
    })
  })

  it('fixes every setting the upload will use, though the caller named none', async () => {
    await call('create_upload_url', {})
    // Nothing is left for the upload to look up later.
    expect(stored().options).toEqual({ options: DEFAULTS })
    expect(Object.keys(stored().options.options).sort()).toEqual([
      'expiration',
      'expiryAction',
      'folderId',
      'profileId',
      'randomizeFileUrls',
      'shareStyle',
      'tagIds',
      'visibility',
    ])
  })

  it('fixes what the account defaults say at that moment', async () => {
    mocks.account.mockResolvedValue({
      randomizeFileUrls: true,
      defaultFileExpiration: 'WEEK',
      defaultFileExpirationAction: 'SET_PRIVATE',
      defaultUploadProfileId: null,
    })
    await call('create_upload_url', {})
    expect(stored().options.options).toEqual({
      ...DEFAULTS,
      expiration: 'WEEK',
      expiryAction: 'SET_PRIVATE',
      randomizeFileUrls: true,
    })
    // The week is kept as a week: it starts when the file arrives.
    expect(stored().options.options).not.toHaveProperty('expiresAt')
  })

  it.each([
    ['hour', 'HOUR'],
    ['day', 'DAY'],
    ['week', 'WEEK'],
    ['month', 'MONTH'],
    ['never', 'DISABLED'],
  ])(
    'keeps `expires_in: %s` as a length of time, not as a time',
    async (expires_in, expiration) => {
      // The caller's length wins over the account's.
      mocks.account.mockResolvedValue({
        randomizeFileUrls: false,
        defaultFileExpiration: 'MONTH',
        defaultFileExpirationAction: 'DELETE',
        defaultUploadProfileId: null,
      })
      await call('create_upload_url', { expires_in })
      expect(stored().options.options).toEqual({ ...DEFAULTS, expiration })
      expect(stored().options.options).not.toHaveProperty('expiresAt')
    }
  )

  it('keeps `expires_at` exactly as the caller stated it, beside the length the defaults give', async () => {
    mocks.account.mockResolvedValue({
      randomizeFileUrls: false,
      defaultFileExpiration: 'DAY',
      defaultFileExpirationAction: 'DELETE',
      defaultUploadProfileId: null,
    })
    await call('create_upload_url', { expires_at: '2031-05-06T07:08:09+02:00' })
    expect(stored().options.options).toEqual({
      ...DEFAULTS,
      expiration: 'DAY',
      // Not rewritten to UTC or to another moment.
      expiresAt: '2031-05-06T07:08:09+02:00',
    })
  })

  it("fixes what the account's default profile says at that moment, and names it", async () => {
    const updatedAt = new Date('2026-11-01T00:00:00.000Z')
    mocks.profiles.mockResolvedValue([
      {
        id: 'profile-shots',
        name: 'Screenshots',
        options: {
          visibility: 'PRIVATE',
          expiration: 'DAY',
          tagIds: ['tag-2026'],
          shareStyle: 'minimal',
        },
        updatedAt,
      },
    ])
    mocks.account.mockResolvedValue({
      randomizeFileUrls: false,
      defaultFileExpiration: 'DISABLED',
      defaultFileExpirationAction: 'DELETE',
      defaultUploadProfileId: 'profile-shots',
    })
    await call('create_upload_url', { tags: ['Invoice'] })
    expect(stored().options.options).toMatchObject({
      visibility: 'PRIVATE',
      expiration: 'DAY',
      shareStyle: 'minimal',
      profileId: 'profile-shots',
      // What the caller named wins over the profile.
      tagIds: ['tag-invoice'],
    })
    // The profile's day is kept as a day.
    expect(stored().options.options).not.toHaveProperty('expiresAt')
  })

  it('fixes "no profile" when the caller asks for none, whatever the account default is', async () => {
    mocks.account.mockResolvedValue({
      randomizeFileUrls: false,
      defaultFileExpiration: 'DISABLED',
      defaultFileExpirationAction: 'DELETE',
      defaultUploadProfileId: 'profile-shots',
    })
    await call('create_upload_url', { profile: 'none' })
    expect(stored().options.options).toMatchObject({ profileId: null })
  })

  it('keeps a password only as the hash the file will carry', async () => {
    const password = 'correct horse battery'
    await call('create_upload_url', { password, visibility: 'public' })
    const row = stored()
    expect(JSON.stringify(row)).not.toContain(password)
    // Every setting is there, and no password among them.
    expect(row.options.options).toEqual(DEFAULTS)
    expect(row.options.options).not.toHaveProperty('password')
    expect(row.options.passwordHash).toMatch(/^\$2[aby]\$10\$/)
    expect(await compare(password, row.options.passwordHash!)).toBe(true)
  })

  it('stores no hash without a password', async () => {
    await call('create_upload_url', { filename: 'a.txt' })
    expect(stored().options).toEqual({ filename: 'a.txt', options: DEFAULTS })
    expect(stored().options).not.toHaveProperty('passwordHash')
  })

  it('writes the type into the command when the caller names one', async () => {
    const answer = await call('create_upload_url', { mime_type: 'Video/MP4' })
    expect(answer.curl).toBe(
      `curl -sS -F "file=@/path/to/file;type=video/mp4" "${answer.upload_url}"`
    )
  })

  it('never writes anything a shell would read into the command', async () => {
    for (const mime_type of [
      'video/mp4"; rm -rf ~; "',
      'video/$(id)',
      'video/`id`',
      'video/mp4 --data @/etc/passwd',
      'video/mp4\nid',
    ])
      await expect(call('create_upload_url', { mime_type })).rejects.toThrow(
        /A MIME type looks like image\/png/
      )
    for (const origin of [
      'https://flare.test/$(id)',
      'https://flare.test/a"b',
      'https://flare.test/a`id`',
      'https://flare.test/a b',
      'https://flare.test/a!b',
      'https://flare.test/a\\b',
    ])
      await expect(
        call('create_upload_url', {}, context({ origin }))
      ).rejects.toThrow(/not safe in a shell command/)
    expect(mocks.createTransfer).not.toHaveBeenCalled()
    // An address with a port, a path and an IPv6 host is still plain.
    const answer = await call(
      'create_upload_url',
      {},
      context({ origin: 'http://[::1]:3000/flare' })
    )
    expect(answer.upload_url).toMatch(
      /^http:\/\/\[::1\]:3000\/flare\/api\/mcp\/transfer\/[A-Za-z0-9_-]{43}$/
    )
  })

  it('refuses now what the upload would refuse later', async () => {
    await expect(
      call('create_upload_url', { password: 'short' })
    ).rejects.toMatchObject({
      status: 400,
      message: 'File passwords must be at least 8 characters.',
    })
    await expect(
      call('create_upload_url', { expires_at: '2020-01-01T00:00:00Z' })
    ).rejects.toMatchObject({
      status: 400,
      message: 'Expiration must be in the future.',
    })
    await expect(
      call('create_upload_url', { folder: 'Nowhere' })
    ).rejects.toThrow(ToolError)
    await expect(call('create_upload_url', { filename: '..' })).rejects.toThrow(
      ToolError
    )
    expect(mocks.createTransfer).not.toHaveBeenCalled()
  })

  it('refuses a profile other than the one its token is bound to', async () => {
    const bound = context({
      user: {
        apiToken: {
          id: 'token-1',
          scopes: ['mcp', 'files:upload'],
          profileId: 'profile-shots',
        },
      },
    })
    await expect(
      call('create_upload_url', { profile: 'Docs' }, bound)
    ).rejects.toMatchObject({
      status: 403,
      message: 'This token is restricted to its upload profile.',
    })
    expect(mocks.createTransfer).not.toHaveBeenCalled()
    await call('create_upload_url', { profile: 'Screenshots' }, bound)
    expect(stored().options.options).toEqual({ profileId: 'profile-shots' })
  })

  it('stores only what was asked for a token bound to a profile, which its uploads follow as it then is', async () => {
    const updatedAt = new Date('2026-11-01T00:00:00.000Z')
    mocks.profiles.mockResolvedValue([
      {
        id: 'profile-shots',
        name: 'Screenshots',
        options: { visibility: 'PRIVATE', expiration: 'DAY' },
        updatedAt,
      },
    ])
    const bound = context({
      user: {
        apiToken: {
          id: 'token-1',
          scopes: ['mcp', 'files:upload'],
          profileId: 'profile-shots',
        },
      },
    })
    await call('create_upload_url', {}, bound)
    // None of the profile's settings is copied into the row.
    expect(stored().options).toEqual({ options: {} })
    mocks.createTransfer.mockClear()
    await call(
      'create_upload_url',
      { filename: 'shot.png', folder: 'Work', password: 'correct horse' },
      bound
    )
    expect(stored().options).toEqual({
      filename: 'shot.png',
      options: { folderId: 'folder-work' },
      passwordHash: expect.stringMatching(/^\$2[aby]\$10\$/),
    })
  })

  it('refuses a bound token that states a setting its profile fixes otherwise', async () => {
    const updatedAt = new Date('2026-11-01T00:00:00.000Z')
    mocks.profiles.mockResolvedValue([
      {
        id: 'profile-shots',
        name: 'Screenshots',
        options: { visibility: 'PRIVATE' },
        updatedAt,
      },
    ])
    const bound = context({
      user: {
        apiToken: {
          id: 'token-1',
          scopes: ['mcp', 'files:upload'],
          profileId: 'profile-shots',
        },
      },
    })
    await expect(
      call('create_upload_url', { visibility: 'public' }, bound)
    ).rejects.toMatchObject({
      status: 403,
      message: 'This token cannot override its upload profile.',
    })
    expect(mocks.createTransfer).not.toHaveBeenCalled()
  })

  it('states the smaller of the file limit and the quota left', async () => {
    mocks.quotas.enabled = true
    const answer = await call(
      'create_upload_url',
      {},
      context({ user: { storageUsed: 7.5 } })
    )
    expect(answer.max_file_bytes).toBe(2.5 * KB * KB)
    mocks.quotas.default = { value: 1, unit: 'GB' }
    const roomy = await call('create_upload_url', {}, context())
    expect(roomy.max_file_bytes).toBe(100 * KB * KB)
    mocks.quotas.default = { value: 10, unit: 'MB' }
  })

  it('refuses when the quota is used up', async () => {
    mocks.quotas.enabled = true
    await expect(
      call('create_upload_url', {}, context({ user: { storageUsed: 10 } }))
    ).rejects.toThrow(
      new ToolError(
        'The storage quota of this account is used up, so nothing can be uploaded. Delete files to make room, or ask an administrator for more.'
      )
    )
    expect(mocks.createTransfer).not.toHaveBeenCalled()
  })

  it('ignores the quota for an account that bypasses it', async () => {
    mocks.quotas.enabled = true
    const answer = await call(
      'create_upload_url',
      {},
      context({
        user: {
          storageUsed: 500,
          permissions: [...DEFAULT_PERMISSIONS, 'quotas.bypass'],
        },
      })
    )
    expect(answer.max_file_bytes).toBe(100 * KB * KB)
  })

  it('stops at the number of URLs one connection may have waiting', async () => {
    mocks.countTransfers.mockResolvedValue(MAX_OUTSTANDING_TRANSFERS)
    await expect(call('create_upload_url', {})).rejects.toThrow(
      `This connection already has ${MAX_OUTSTANDING_TRANSFERS} upload URLs waiting. Use them, or wait a few minutes for them to expire.`
    )
    expect(mocks.createTransfer).not.toHaveBeenCalled()
    // Upload URLs are counted on their own, apart from download links.
    expect(mocks.countTransfers).toHaveBeenCalledWith({
      where: { userId: 'owner', credential: 'token:token-1', kind: 'upload' },
    })
  })
})

describe('the upload tools', () => {
  it('are the three the catalog lists, each pointing larger files at the URL tool', () => {
    expect(uploadsTools.map(({ name }) => name)).toEqual([
      'upload_file',
      'create_paste',
      'create_upload_url',
    ])
    expect(tool('upload_file').description).toContain('create_upload_url')
    const urlTool = tool('create_upload_url').description
    expect(urlTool).toContain('/path/to/file')
    expect(urlTool).toContain('once')
    expect(urlTool).toContain('15 minutes')
    expect(urlTool).toContain('JSON')
    for (const { description } of uploadsTools)
      expect(description).not.toContain('—')
  })

  it('share one set of options', () => {
    const shared = [
      'visibility',
      'password',
      'expires_at',
      'expires_in',
      'expiry_action',
      'folder',
      'tags',
      'profile',
    ]
    for (const { input } of uploadsTools)
      expect(Object.keys(input.shape)).toEqual(expect.arrayContaining(shared))
  })
})
