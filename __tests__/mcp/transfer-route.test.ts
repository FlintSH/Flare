import { GET, POST } from '@/app/api/mcp/transfer/[ticket]/route'
import type { Prisma } from '@prisma/client'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArchiveError } from '@/lib/archives/errors'
import { auditSettled, configureAuditWriter } from '@/lib/audit'
import { HttpError } from '@/lib/http/errors'
import { hashApiToken } from '@/lib/integrations/tokens'
import { ToolError } from '@/lib/mcp/tool'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import { PermissionError } from '@/lib/permissions/server'
import { newLinkToken } from '@/lib/security/link-token'
import type { FixedUpload } from '@/lib/uploads/direct'

type TransferRow = {
  id: string
  secretHash: string
  userId: string
  credential: string
  kind: string
  fileId: string | null
  options: unknown
  expiresAt: Date
  claimedAt: Date | null
  createdAt: Date
}
type FileRow = {
  id: string
  name: string
  userId: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  path: string
  mimeType: string
}

const state = vi.hoisted(() => ({
  transfers: [] as TransferRow[],
  files: [] as FileRow[],
  tokens: [] as Array<Record<string, unknown> & { id: string }>,
  connections: [] as Array<Record<string, unknown> & { id: string }>,
  users: [] as Array<{ id: string; sessionVersion: number }>,
  /** The transfer table cannot be read. */
  unreadable: false,
  everyone: [] as string[],
  enabled: true,
  administration: false,
  storage: undefined as unknown,
  audits: [] as Array<Record<string, unknown>>,
}))

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  serverSession: vi.fn(),
  countFile: vi.fn(),
  directUpload: vi.fn(),
  consume: vi.fn(),
  verifyEmail: vi.fn(),
  queries: vi.fn(),
  readEntry: vi.fn(),
  readSharedEntry: vi.fn(),
  exportData: vi.fn(),
}))

// Either would answer a signed-in administrator, if anything asked.
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.serverSession }))
vi.mock('next-auth/next', () => ({ getServerSession: mocks.serverSession }))
vi.mock('@/lib/database/prisma', () => {
  type Where = {
    id?: string
    secretHash?: string
    claimedAt?: null
    expiresAt?: { gt: Date }
  }
  const matches = (row: TransferRow, where: Where) =>
    (where.id === undefined || row.id === where.id) &&
    (where.secretHash === undefined || row.secretHash === where.secretHash) &&
    (!('claimedAt' in where) || row.claimedAt === null) &&
    (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt)
  return {
    prisma: {
      agentTransfer: {
        findUnique: async ({ where }: { where: Where }) => {
          mocks.queries('agentTransfer.findUnique')
          if (state.unreadable) throw new Error('Database unavailable')
          return state.transfers.find((row) => matches(row, where)) ?? null
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Where
          data: Partial<TransferRow>
        }) => {
          mocks.queries('agentTransfer.updateMany')
          const found = state.transfers.filter((row) => matches(row, where))
          for (const row of found) Object.assign(row, data)
          return { count: found.length }
        },
        deleteMany: async ({ where }: { where: Where }) => {
          mocks.queries('agentTransfer.deleteMany')
          state.transfers = state.transfers.filter(
            (row) => !matches(row, where)
          )
          return { count: 1 }
        },
      },
      apiToken: {
        findUnique: async ({ where }: { where: { id?: string } }) => {
          mocks.queries('apiToken.findUnique')
          // Like the database: found by its key, never by anything else.
          return state.tokens.find((token) => token.id === where.id) ?? null
        },
      },
      agentConnection: {
        findUnique: async ({ where }: { where: { id?: string } }) => {
          mocks.queries('agentConnection.findUnique')
          return state.connections.find((row) => row.id === where.id) ?? null
        },
      },
      role: {
        findUnique: async () => ({
          id: 'everyone',
          name: 'Everyone',
          description: '',
          color: '#000000',
          position: 0,
          systemKey: 'everyone',
          permissions: state.everyone,
        }),
      },
      file: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          mocks.queries('file.findUnique')
          return state.files.find((file) => file.id === where.id) ?? null
        },
        findFirst: async ({
          where,
        }: {
          where: { id: string; userId: string }
        }) => {
          mocks.queries('file.findFirst')
          return (
            state.files.find(
              (file) => file.id === where.id && file.userId === where.userId
            ) ?? null
          )
        },
        update: mocks.countFile,
      },
      // The account's row, for the session version it is on.
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          mocks.queries('user.findUnique')
          return state.users.find((user) => user.id === where.id) ?? null
        },
      },
    },
  }
})
// The library's archive reader and the account export, which the route only
// calls: what they are handed is what these tests are about.
vi.mock('@/lib/archives/service', () => ({
  readArchiveEntry: mocks.readEntry,
  readSharedArchiveEntry: mocks.readSharedEntry,
}))
vi.mock('@/lib/users/export', () => ({
  exportAccountData: mocks.exportData,
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: vi.fn(async () => ({})),
}))
vi.mock('@/lib/email/policy', () => ({
  requiresEmailVerification: mocks.verifyEmail,
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      general: {
        mcp: { enabled: state.enabled, administration: state.administration },
      },
    },
  }),
  // As the real one does, it reads the settings through the client it is
  // handed, so a test can tell a transaction's view from the cached one.
  readConfig: async (client: {
    config: { findUnique: (query: object) => Promise<{ value: unknown }> }
  }) => ({
    settings: (
      await client.config.findUnique({ where: { key: 'flare_config' } })
    ).value,
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.storage,
}))
vi.mock('@/lib/uploads/direct', () => ({ directUpload: mocks.directUpload }))
vi.mock('@/lib/security/rate-limit', () => ({
  uploadLimiter: { consume: mocks.consume, duration: 60 },
}))
vi.mock('@/lib/logger', () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  return {
    loggers: new Proxy({}, { get: () => logger }),
    createLogger: () => logger,
  }
})

const ORIGIN = 'https://flare.test'
const TEMPLATE = '/api/mcp/transfer/[ticket]'
const bytes = Buffer.from('0123456789')
const NOT_FOUND = { error: 'Not found' }

const account = {
  id: 'owner',
  name: 'Alex',
  email: 'alex@example.com',
  image: null,
  sessionVersion: 1,
  passkeyRequired: false,
  emailVerified: null,
  emailVerifiedFor: null,
  emailVerificationSource: null,
  emailExempt: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  storageUsed: 2,
  urlId: 'alex',
  vanityId: null,
  randomizeFileUrls: false,
  roles: [],
}
const token = {
  id: 'token-1',
  userId: 'owner',
  name: 'Agent',
  hash: hashApiToken('flr_AgentToken'),
  scopes: ['files:read', 'files:content', 'files:upload', 'urls:read', 'mcp'],
  profileId: null as string | null,
  revokedAt: null as Date | null,
  expiresAt: null as Date | null,
  lastUsedAt: null,
  user: account,
}
const withToken = (override: Partial<typeof token>) => {
  state.tokens = [{ ...token, ...override }]
}
/** An agent that signed in through the browser, and holds no token row. */
const connection = {
  id: 'connection-1',
  userId: 'owner',
  clientId: 'flc_client',
  clientName: 'Claude Code (flare)',
  redirectUri: 'http://localhost:53124/callback',
  scopes: ['files:read', 'files:content', 'files:upload', 'urls:read'],
  lastUsedAt: null,
  revokedAt: null as Date | null,
  revokedReason: null as string | null,
  user: account,
}
const withConnection = (override: Partial<typeof connection>) => {
  state.connections = [{ ...connection, ...override }]
}

const file: FileRow = {
  id: 'file-1',
  name: 'notes.txt',
  userId: 'owner',
  visibility: 'PUBLIC',
  password: null,
  path: 'uploads/alex/key/notes.txt',
  mimeType: 'text/plain',
}

const fixedUpload = {
  filename: 'report.pdf',
  options: { visibility: 'PRIVATE', folderId: 'folder-1', tagIds: ['tag-1'] },
  passwordHash: '$2b$10$storedhashstoredhashstoredhashstoredhashstoredhashstor',
}

const KINDS = ['download', 'archive-entry', 'export', 'upload'] as const
type Kind = (typeof KINDS)[number]
/** The entry an archive-entry URL is made for, unless a test says otherwise. */
const ENTRY = { path: 'docs/readme.md' }

/** A transfer row and the secret its URL carries. */
function transfer(kind: Kind, overrides: Partial<TransferRow> = {}) {
  const secret = newLinkToken()
  const row: TransferRow = {
    id: `transfer-${state.transfers.length + 1}`,
    secretHash: hashApiToken(secret),
    userId: 'owner',
    credential: 'token:token-1',
    kind,
    fileId: kind === 'download' || kind === 'archive-entry' ? 'file-1' : null,
    options:
      kind === 'upload'
        ? fixedUpload
        : kind === 'archive-entry'
          ? { entry: ENTRY }
          : null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    claimedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
  state.transfers.push(row)
  return { secret, row }
}

const at = (secret: string) => ({ params: Promise.resolve({ ticket: secret }) })
const url = (secret: string, query = '') =>
  `${ORIGIN}/api/mcp/transfer/${secret}${query}`
const download = (secret: string, init?: RequestInit) =>
  GET(new Request(url(secret), init), at(secret))

/** An upload as curl sends it, with whatever else the sender adds. */
async function upload(
  secret: string,
  {
    fields = {},
    headers = {},
    query = '',
  }: {
    fields?: Record<string, string>
    headers?: Record<string, string>
    query?: string
  } = {}
) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  form.set('file', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'a.pdf')
  const encoded = new Response(form)
  return POST(
    new Request(url(secret, query), {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': encoded.headers.get('content-type')!,
      },
      body: new Uint8Array(await encoded.arrayBuffer()),
    }),
    at(secret)
  )
}

function memoryStorage(content = bytes) {
  return {
    getFileSize: vi.fn(async () => content.length),
    getFileStream: vi.fn(
      async (_path: string, range?: { start: number; end: number }) =>
        Readable.from([
          range ? content.subarray(range.start, range.end + 1) : content,
        ])
    ),
    getDownloadUrl: vi.fn(async () => 'https://storage.example/signed'),
  }
}

/** Everything a client can tell one answer from another by. */
async function shape(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  }
}

async function expectNotFound(response: Response) {
  expect(await shape(response)).toEqual({
    status: 404,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'referrer-policy': 'no-referrer',
    },
    body: JSON.stringify(NOT_FOUND),
  })
}

/** The audit events of the request just answered. */
async function audited() {
  await auditSettled()
  return state.audits
}

const links = {
  id: 'file-new',
  url: `${ORIGIN}/alex/report.pdf`,
  pageUrl: `${ORIGIN}/alex/report.pdf`,
  rawUrl: `${ORIGIN}/api/files/alex/report.pdf`,
  downloadUrl: `${ORIGIN}/api/files/file-new/download`,
  copyText: `${ORIGIN}/alex/report.pdf`,
  name: 'report.pdf',
  size: 8,
  type: 'application/pdf',
}

/** What the archive reader answers for the whole of a small entry. */
const entryAnswer = () =>
  new Response(new Uint8Array(bytes), {
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="readme.md"',
      'Content-Length': String(bytes.length),
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    },
  })

/** An export as the account export hands it over: a name and a body to read. */
function exportOf(chunks: string[]) {
  let sent = 0
  const cancelled = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < chunks.length)
        controller.enqueue(new TextEncoder().encode(chunks[sent++]))
      else controller.close()
    },
    cancel: cancelled,
  })
  return { filename: 'flare-data-export-1.zip', body, cancelled }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.transfers = []
  state.files = [{ ...file }]
  state.tokens = [{ ...token }]
  state.connections = [{ ...connection }]
  state.users = [{ id: 'owner', sessionVersion: 1 }]
  state.unreadable = false
  mocks.readEntry.mockImplementation(async () => entryAnswer())
  mocks.readSharedEntry.mockImplementation(async () => entryAnswer())
  state.administration = false
  mocks.exportData.mockImplementation(async () => exportOf(['PK', 'zip']))
  state.everyone = [...DEFAULT_PERMISSIONS]
  state.enabled = true
  state.storage = memoryStorage()
  state.audits = []
  configureAuditWriter(async (event) => void state.audits.push(event))
  mocks.verifyEmail.mockReturnValue(false)
  mocks.consume.mockResolvedValue(undefined)
  mocks.directUpload.mockResolvedValue(links)
  mocks.session.mockResolvedValue({ user: { id: 'admin' } })
  mocks.serverSession.mockResolvedValue({ user: { id: 'admin' } })
  mocks.countFile.mockResolvedValue(undefined)
})
// A served file is recorded after its response; keep that out of the next test.
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
})

/** The kinds whose URLs name a file of the account. */
const OF_A_FILE: Kind[] = ['download', 'archive-entry']
/** The kinds whose URLs send something, which need what reading needs. */
const SENT: Kind[] = ['download', 'archive-entry', 'export']

/** What makes a URL unusable, for every kind unless it names some. */
const refusals: Array<{
  name: string
  kinds?: Kind[]
  outcome: 'failure' | 'denied'
  /** The row is not even found, so a GET cannot tell what it was for. */
  unfound?: true
  arrange: (row: TransferRow) => void
}> = [
  {
    name: 'it has expired',
    outcome: 'failure',
    unfound: true,
    arrange: (row) => (row.expiresAt = new Date(Date.now() - 1)),
  },
  {
    name: 'its token was revoked',
    outcome: 'denied',
    arrange: () => withToken({ revokedAt: new Date() }),
  },
  {
    name: 'its token has expired',
    outcome: 'denied',
    arrange: () => withToken({ expiresAt: new Date(Date.now() - 1) }),
  },
  {
    name: 'its token was deleted',
    outcome: 'denied',
    arrange: () => (state.tokens = []),
  },
  {
    name: 'its token no longer carries Agent access',
    outcome: 'denied',
    arrange: () =>
      withToken({ scopes: ['files:read', 'files:content', 'files:upload'] }),
  },
  {
    name: 'its token lost the scope for reading contents',
    kinds: SENT,
    outcome: 'denied',
    arrange: () =>
      withToken({ scopes: ['files:read', 'files:upload', 'urls:read', 'mcp'] }),
  },
  {
    name: 'its token lost the scope for reading short links, which an export holds',
    kinds: ['export'],
    outcome: 'denied',
    arrange: () =>
      withToken({ scopes: ['files:read', 'files:content', 'mcp'] }),
  },
  {
    name: 'its token lost the scope for listing files, which an export holds',
    kinds: ['export'],
    outcome: 'denied',
    arrange: () => withToken({ scopes: ['files:content', 'urls:read', 'mcp'] }),
  },
  {
    name: 'its token lost the upload scope',
    kinds: ['upload'],
    outcome: 'denied',
    arrange: () =>
      withToken({ scopes: ['files:read', 'files:content', 'mcp'] }),
  },
  {
    name: 'the role no longer lets the account export its data',
    kinds: ['export'],
    outcome: 'denied',
    arrange: () =>
      (state.everyone = DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'profile.export'
      )),
  },
  {
    name: 'the role no longer lets the account see its short links, which an export holds',
    kinds: ['export'],
    outcome: 'denied',
    arrange: () =>
      (state.everyone = DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'links.read'
      )),
  },
  {
    name: 'the role no longer lets the account read files',
    kinds: SENT,
    outcome: 'denied',
    arrange: () =>
      (state.everyone = DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'files.read'
      )),
  },
  {
    name: 'the role no longer lets the account upload',
    kinds: ['upload'],
    outcome: 'denied',
    arrange: () =>
      (state.everyone = DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'files.upload'
      )),
  },
  {
    name: 'the account must verify its email first',
    outcome: 'denied',
    arrange: () => mocks.verifyEmail.mockReturnValue(true),
  },
  {
    name: 'its token now belongs to another account',
    outcome: 'denied',
    arrange: () =>
      withToken({ userId: 'other', user: { ...account, id: 'other' } }),
  },
  {
    name: 'its credential is not one this server knows',
    outcome: 'denied',
    arrange: (row) => (row.credential = 'session:owner'),
  },
  {
    name: 'the file was deleted',
    kinds: OF_A_FILE,
    outcome: 'failure',
    arrange: () => (state.files = []),
  },
  {
    name: 'the file belongs to another account now',
    kinds: OF_A_FILE,
    outcome: 'denied',
    arrange: () => (state.files = [{ ...file, userId: 'other' }]),
  },
  {
    name: 'its row names no file',
    kinds: OF_A_FILE,
    outcome: 'failure',
    arrange: (row) => (row.fileId = null),
  },
  {
    name: 'its row names no entry',
    kinds: ['archive-entry'],
    outcome: 'failure',
    arrange: (row) => (row.options = null),
  },
  {
    name: 'its row names an entry that is neither a path nor a position',
    kinds: ['archive-entry'],
    outcome: 'failure',
    arrange: (row) => (row.options = { entry: { path: '', position: 2 } }),
  },
  {
    name: 'the archive went while its entry was being found',
    kinds: ['archive-entry'],
    outcome: 'failure',
    arrange: () =>
      mocks.readEntry.mockRejectedValue(
        new ArchiveError('One or more source files are unavailable.', 404)
      ),
  },
  {
    name: 'the archive no longer holds the entry',
    kinds: ['archive-entry'],
    outcome: 'failure',
    arrange: () =>
      mocks.readEntry.mockRejectedValue(
        new ArchiveError('Archive entry not found.', 404)
      ),
  },
  {
    name: 'the role changed while its entry was being found',
    kinds: ['archive-entry'],
    outcome: 'denied',
    arrange: () =>
      mocks.readEntry.mockRejectedValue(
        new PermissionError('You no longer have permission for this action')
      ),
  },
  {
    name: 'the account was signed out everywhere while its entry was being found',
    kinds: ['archive-entry'],
    outcome: 'denied',
    arrange: () =>
      mocks.readEntry.mockRejectedValue(
        new ArchiveError('Sign in again before creating files.', 401)
      ),
  },
  {
    name: 'its credential ended while its entry was being found',
    kinds: ['archive-entry'],
    outcome: 'denied',
    arrange: () =>
      mocks.readEntry.mockRejectedValue(
        new ToolError('This connection was disconnected.', 'denied')
      ),
  },
  {
    name: 'the account went the moment its entry was asked for',
    kinds: ['archive-entry'],
    outcome: 'denied',
    arrange: () => (state.users = []),
  },
  {
    name: 'the account went the moment its export was asked for',
    kinds: ['export'],
    outcome: 'failure',
    arrange: () =>
      mocks.exportData.mockRejectedValue(new HttpError(404, 'User not found')),
  },
  {
    name: 'the stored object is gone',
    kinds: ['download'],
    outcome: 'failure',
    arrange: () =>
      (state.storage = {
        ...memoryStorage(),
        getFileSize: vi.fn(async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }),
      }),
  },
]

describe.each(KINDS)('a %s URL', (kind) => {
  const send = (secret: string) =>
    kind === 'upload' ? upload(secret) : download(secret)
  const action = `mcp.transfer.${kind}`

  it('answers 404 for a ticket nobody was given', async () => {
    transfer(kind)
    await expectNotFound(await send(newLinkToken()))
    expect(await audited()).toEqual([
      expect.objectContaining({
        // A GET that names nothing is recorded as the plain download it
        // asked for: only a row says what else it might have been.
        action: kind === 'upload' ? action : 'mcp.transfer.download',
        category: 'mcp',
        outcome: 'failure',
        status: 404,
        route: TEMPLATE,
      }),
    ])
  })

  it.each([
    ['short'],
    ['a'.repeat(44)],
    ['..%2F..%2Fetc'],
    ['a'.repeat(42) + '!'],
  ])(
    'answers 404 for the malformed ticket %j without a lookup',
    async (secret) => {
      await expectNotFound(await send(secret))
      expect(mocks.queries).not.toHaveBeenCalled()
    }
  )

  it.each(
    // A URL that sends is no upload URL, and an upload URL sends nothing.
    kind === 'upload' ? SENT : (['upload'] as Kind[])
  )('answers 404 for a %s URL sent the other way', async (other) => {
    const { secret, row } = transfer(other)
    await expectNotFound(await send(secret))
    // Nothing was claimed, served or uploaded.
    expect(row.claimedAt).toBeNull()
    expect(mocks.directUpload).not.toHaveBeenCalled()
    expect(mocks.readEntry).not.toHaveBeenCalled()
    expect(mocks.exportData).not.toHaveBeenCalled()
    expect(mocks.queries.mock.calls.flat()).toEqual([
      'agentTransfer.findUnique',
    ])
  })

  it('answers 404 while the MCP server is off, and records nothing', async () => {
    const { secret, row } = transfer(kind)
    state.enabled = false
    await expectNotFound(await send(secret))
    // Not even the ticket is looked up.
    expect(mocks.queries).not.toHaveBeenCalled()
    expect(row.claimedAt).toBeNull()
    expect(mocks.directUpload).not.toHaveBeenCalled()
    expect(await audited()).toEqual([])
    // Turned back on, the same URL works again.
    state.enabled = true
    expect((await send(secret)).status).toBe(200)
  })

  it.each(refusals.filter(({ kinds = KINDS }) => kinds.includes(kind)))(
    'answers the same 404 when $name',
    async ({ arrange, outcome, unfound }) => {
      const { secret, row } = transfer(kind)
      arrange(row)
      const response = await send(secret)
      await expectNotFound(response)
      expect(row.claimedAt).toBeNull()
      expect(mocks.directUpload).not.toHaveBeenCalled()
      expect(mocks.consume).not.toHaveBeenCalled()
      // Nothing of the account was sent, whatever the URL was for.
      const storage = state.storage as ReturnType<typeof memoryStorage>
      expect(storage.getFileStream).not.toHaveBeenCalled()
      const events = await audited()
      expect(events).toEqual([
        expect.objectContaining({
          // Like a ticket nobody was given: a plain download that failed.
          action:
            unfound && kind !== 'upload' ? 'mcp.transfer.download' : action,
          category: 'mcp',
          outcome,
          status: 404,
        }),
      ])
      // The route is recorded as its template; the secret is recorded nowhere.
      expect(events[0].route).toBe(TEMPLATE)
      expect(JSON.stringify(events)).not.toContain(secret)
    }
  )

  it('decides from the row, whatever credential the request carries', async () => {
    const { secret } = transfer(kind)
    withToken({ revokedAt: new Date() })
    // A second, perfectly good token and a browser session ride along.
    state.tokens.push({
      ...token,
      id: 'token-2',
      hash: hashApiToken('flr_Other'),
    })
    const headers = {
      Authorization: 'Bearer flr_Other',
      Cookie: 'next-auth.session-token=signed-in-administrator',
    }
    const response =
      kind === 'upload'
        ? await upload(secret, { headers })
        : await download(secret, { headers })
    await expectNotFound(response)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it('never answers with CORS headers, even where other sites may call the API', async () => {
    vi.stubEnv('FLARE_CORS_ORIGINS', '*')
    const { secret } = transfer(kind)
    const headers = { Origin: 'https://app.example.com' }
    const response =
      kind === 'upload'
        ? await upload(secret, { headers })
        : await download(secret, { headers })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('vary')).toBeNull()
  })
})

describe('downloading through a transfer URL', () => {
  it('sends the file as a download that nothing may cache', async () => {
    const { secret } = transfer('download')
    const response = await download(secret)
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'content-disposition': expect.stringMatching(
        /^attachment; filename="notes\.txt"/
      ),
      'content-length': '10',
      'content-type': 'text/plain',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    })
    expect(await response.text()).toBe('0123456789')
  })

  it('records the download under the account and token it was made for', async () => {
    const { secret } = transfer('download')
    await download(secret)
    const events = await audited()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'mcp.transfer.download',
        category: 'mcp',
        outcome: 'success',
        status: 200,
        method: 'GET',
        route: TEMPLATE,
        actorId: 'owner',
        actorName: 'Alex',
        targetType: 'file',
        targetId: 'file-1',
        targetName: 'notes.txt',
      }),
    ])
    expect(events[0].details).toMatchObject({ tokenId: 'token-1' })
    expect(JSON.stringify(events)).not.toContain(secret)
  })

  it('honours a Range request', async () => {
    const { secret } = transfer('download')
    const response = await download(secret, { headers: { Range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-length')).toBe('4')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.text()).toBe('2345')
    const tail = await download(secret, { headers: { Range: 'bytes=-3' } })
    expect(tail.status).toBe(206)
    expect(await tail.text()).toBe('789')
  })

  it('answers a range past the end without the file or a cacheable answer', async () => {
    const { secret } = transfer('download')
    const response = await download(secret, {
      headers: { Range: 'bytes=50-60' },
    })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.text()).toBe('')
  })

  it('works again and again until it expires, so a download can resume', async () => {
    const { secret, row } = transfer('download')
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await download(secret)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('0123456789')
    }
    expect(row.claimedAt).toBeNull()
    expect(state.transfers).toEqual([row])
    row.expiresAt = new Date(Date.now() - 1)
    await expectNotFound(await download(secret))
  })

  it('counts neither a view nor a download', async () => {
    const { secret } = transfer('download')
    await (await download(secret)).text()
    await (await download(secret, { headers: { Range: 'bytes=0-1' } })).text()
    expect(mocks.countFile).not.toHaveBeenCalled()
  })

  it('never consults a browser session, and sends its own bytes, not a storage link', async () => {
    const storage = memoryStorage()
    state.storage = storage
    const { secret } = transfer('download')
    const response = await download(secret, {
      headers: { Cookie: 'next-auth.session-token=signed-in-administrator' },
    })
    expect(response.status).toBe(200)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
    expect(storage.getDownloadUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['a private file', { visibility: 'PRIVATE' as const }],
    ['a file with a password', { password: '$2b$10$filepasswordhash' }],
  ])(
    'opens %s for the account that owns it, without asking for more',
    async (_what, change) => {
      state.files = [{ ...file, ...change }]
      const { secret } = transfer('download')
      const response = await download(secret)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).toBe('0123456789')
    }
  )

  it('serves the file its row names, not one the request names', async () => {
    state.files.push({ ...file, id: 'file-2', name: 'other.txt' })
    const { secret } = transfer('download')
    const response = await GET(
      new Request(url(secret, '?file=file-2&fileId=file-2&id=file-2')),
      at(secret)
    )
    expect(response.headers.get('content-disposition')).toContain('notes.txt')
  })

  it('reports a storage failure as its own error, with nothing cacheable', async () => {
    state.storage = {
      ...memoryStorage(),
      getFileSize: vi.fn(async () => {
        throw new Error('disk on fire')
      }),
    }
    const { secret } = transfer('download')
    const response = await download(secret)
    expect(await shape(response)).toEqual({
      status: 500,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'referrer-policy': 'no-referrer',
      },
      body: JSON.stringify({ error: 'The transfer could not be completed.' }),
    })
  })
})

describe('a download whose row cannot be read', () => {
  it.each(SENT)(
    'answers the transfer error for a %s URL, and records it as any failed request',
    async (kind) => {
      const { secret } = transfer(kind)
      state.unreadable = true
      expect(await shape(await download(secret))).toEqual({
        status: 500,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
          'referrer-policy': 'no-referrer',
        },
        body: JSON.stringify({ error: 'The transfer could not be completed.' }),
      })
      const events = await audited()
      expect(events).toEqual([
        expect.objectContaining({
          // The row would have said what it was; without it, a download.
          action: 'mcp.transfer.download',
          category: 'mcp',
          outcome: 'failure',
          status: 500,
          route: TEMPLATE,
        }),
      ])
      expect(JSON.stringify(events)).not.toContain(secret)
      expect(mocks.readEntry).not.toHaveBeenCalled()
      expect(mocks.exportData).not.toHaveBeenCalled()
    }
  )
})

describe('downloading one entry of an archive through a transfer URL', () => {
  /** What the archive reader was handed on its only call. */
  const handed = () => {
    expect(mocks.readEntry).toHaveBeenCalledOnce()
    const [actor, id, selector, request, inline] = mocks.readEntry.mock
      .calls[0] as [
      {
        user: Record<string, unknown>
        sessionVersion: number
        authorize: unknown
      },
      string,
      unknown,
      Request,
      boolean,
    ]
    return { actor, id, selector, request, inline }
  }

  it('sends what the archive reader answers, as a download that nothing may cache', async () => {
    const { secret } = transfer('archive-entry')
    const response = await download(secret)
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'accept-ranges': 'bytes',
      // The reader's own `private, no-store` gives way to the transfer's.
      'cache-control': 'no-store',
      'content-disposition': 'attachment; filename="readme.md"',
      'content-length': '10',
      'content-type': 'application/octet-stream',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    })
    expect(await response.text()).toBe('0123456789')
  })

  it('asks the reader for the file and the entry its row names, as the account, and never inline', async () => {
    const { secret } = transfer('archive-entry')
    await download(secret)
    const { actor, id, selector, inline } = handed()
    expect(id).toBe('file-1')
    expect(selector).toEqual({ path: 'docs/readme.md' })
    expect(inline).toBe(false)
    expect(actor.user).toMatchObject({
      id: 'owner',
      credential: 'token',
      apiToken: { id: 'token-1' },
    })
    // The session version the account is on as the request arrives, and the
    // check the reader runs if finding the entry takes long.
    expect(actor.sessionVersion).toBe(1)
    expect(actor.authorize).toEqual(expect.any(Function))
  })

  it('reads an entry its row names by position', async () => {
    const { secret } = transfer('archive-entry', {
      options: { entry: { position: 12 } },
    })
    await download(secret)
    expect(handed().selector).toEqual({ position: 12 })
  })

  it('serves the entry its row names, whatever the request names', async () => {
    state.files.push({ ...file, id: 'file-2', name: 'other.zip' })
    const { secret } = transfer('archive-entry')
    await GET(
      new Request(
        url(
          secret,
          '?path=secrets.txt&entry=3&file=file-2&id=file-2&disposition=inline'
        )
      ),
      at(secret)
    )
    const { id, selector, inline } = handed()
    expect(id).toBe('file-1')
    expect(selector).toEqual({ path: 'docs/readme.md' })
    expect(inline).toBe(false)
  })

  it('hands the reader the request itself, so a Range is honoured as the reader honours it', async () => {
    mocks.readEntry.mockImplementation(
      async (
        _actor: unknown,
        _id: string,
        _entry: unknown,
        request: Request
      ) =>
        request.headers.get('range') === 'bytes=2-5'
          ? new Response('2345', {
              status: 206,
              headers: { 'Content-Range': 'bytes 2-5/10' },
            })
          : new Response(null, {
              status: 416,
              headers: { 'Content-Range': 'bytes */10' },
            })
    )
    const { secret } = transfer('archive-entry')
    const part = await download(secret, { headers: { Range: 'bytes=2-5' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(part.headers.get('cache-control')).toBe('no-store')
    expect(part.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await part.text()).toBe('2345')
    const past = await download(secret, { headers: { Range: 'bytes=50-60' } })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */10')
    expect(past.headers.get('cache-control')).toBe('no-store')
    expect(await past.text()).toBe('')
  })

  it('works again and again until it expires, so a download can resume', async () => {
    const { secret, row } = transfer('archive-entry')
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await download(secret)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('0123456789')
    }
    expect(row.claimedAt).toBeNull()
    expect(state.transfers).toEqual([row])
    row.expiresAt = new Date(Date.now() - 1)
    await expectNotFound(await download(secret))
    expect(mocks.readEntry).toHaveBeenCalledTimes(3)
  })

  it('records the download under its own action, the account and the archive', async () => {
    const { secret } = transfer('archive-entry')
    await (await download(secret)).text()
    const events = await audited()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'mcp.transfer.archive-entry',
        category: 'mcp',
        outcome: 'success',
        status: 200,
        method: 'GET',
        route: TEMPLATE,
        actorId: 'owner',
        actorName: 'Alex',
        targetType: 'file',
        targetId: 'file-1',
        targetName: 'notes.txt',
      }),
    ])
    expect(events[0].details).toMatchObject({ tokenId: 'token-1' })
    // Neither the secret nor the name of the entry is recorded here.
    expect(JSON.stringify(events)).not.toContain(secret)
    expect(JSON.stringify(events)).not.toContain('readme.md')
  })

  it('counts neither a view nor a download, and reads nothing but through the reader', async () => {
    const { secret } = transfer('archive-entry')
    await (await download(secret)).text()
    await (await download(secret, { headers: { Range: 'bytes=0-1' } })).text()
    expect(mocks.countFile).not.toHaveBeenCalled()
    const storage = state.storage as ReturnType<typeof memoryStorage>
    expect(storage.getFileStream).not.toHaveBeenCalled()
    expect(storage.getDownloadUrl).not.toHaveBeenCalled()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it.each([
    ['a private archive', { visibility: 'PRIVATE' as const }],
    ['an archive with a password', { password: '$2b$10$filepasswordhash' }],
  ])(
    'opens %s for the account that owns it, without asking for more',
    async (_what, change) => {
      state.files = [{ ...file, ...change }]
      const { secret } = transfer('archive-entry')
      expect((await download(secret)).status).toBe(200)
    }
  )

  it('answers a busy reader as the archive routes do, and says when to come back', async () => {
    mocks.readEntry.mockRejectedValue(
      new ArchiveError(
        'Too many archive files are open at once. Close a preview or wait for a download to finish, then try again.',
        429
      )
    )
    const { secret } = transfer('archive-entry')
    const response = await download(secret)
    expect(await shape(response)).toEqual({
      status: 429,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'referrer-policy': 'no-referrer',
        'retry-after': '5',
      },
      body: JSON.stringify({
        error:
          'Too many archive files are open at once. Close a preview or wait for a download to finish, then try again.',
      }),
    })
  })

  it.each([
    [
      415,
      'This file is encrypted inside the archive. Download the whole archive and open it with its password.',
    ],
    [409, 'A source file changed or was removed. Refresh and try again.'],
  ])(
    'answers what the reader says about an entry it cannot send (%i)',
    async (status, message) => {
      mocks.readEntry.mockRejectedValue(new ArchiveError(message, status))
      const { secret } = transfer('archive-entry')
      const response = await download(secret)
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: message })
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  )

  it('reports a failure of its own as the transfer error, with nothing cacheable', async () => {
    mocks.readEntry.mockRejectedValue(new Error('disk on fire'))
    const { secret } = transfer('archive-entry')
    expect(await shape(await download(secret))).toEqual({
      status: 500,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'referrer-policy': 'no-referrer',
      },
      body: JSON.stringify({ error: 'The transfer could not be completed.' }),
    })
  })
})

describe('downloading the account export through a transfer URL', () => {
  /** A download that stays open until the test lets its export go on. */
  function slowExport() {
    let more!: (chunk: string | null) => void
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await new Promise<string | null>(
          (resolve) => (more = resolve)
        )
        if (chunk === null) controller.close()
        else controller.enqueue(new TextEncoder().encode(chunk))
      },
      cancel: cancelled,
    })
    mocks.exportData.mockResolvedValueOnce({
      filename: 'flare-data-export-1.zip',
      body,
    })
    return {
      cancelled,
      /** Hands the export its next bytes once it asks for them. */
      async send(chunk: string | null) {
        await vi.waitFor(() => expect(more).toBeTypeOf('function'))
        const give = more
        more = undefined as never
        give(chunk)
      },
    }
  }

  it('sends the export as a ZIP download that nothing may cache', async () => {
    const { secret } = transfer('export')
    const response = await download(secret)
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toEqual({
      'cache-control': 'no-store',
      'content-disposition': 'attachment; filename="flare-data-export-1.zip"',
      'content-type': 'application/zip',
      'referrer-policy': 'no-referrer',
    })
    expect(await response.text()).toBe('PKzip')
  })

  it('exports the account its row names, under an id of its own, until the request ends', async () => {
    const { secret } = transfer('export')
    const controller = new AbortController()
    await (await download(secret, { signal: controller.signal })).text()
    expect(mocks.exportData).toHaveBeenCalledOnce()
    const [userId, options] = mocks.exportData.mock.calls[0] as [
      string,
      { exportId: string; signal: AbortSignal },
    ]
    expect(userId).toBe('owner')
    expect(Object.keys(options).sort()).toEqual(['exportId', 'signal'])
    expect(options.exportId).toMatch(/^[0-9a-f]{32}$/)
    expect(options.signal.aborted).toBe(false)
    controller.abort()
    expect(options.signal.aborted).toBe(true)
  })

  it('exports nothing the request names: not another account, not an id of its choosing', async () => {
    const first = transfer('export')
    const second = transfer('export')
    const chosen = 'a'.repeat(32)
    for (const { secret } of [first, second])
      await (
        await GET(
          new Request(
            url(secret, `?id=${chosen}&user=other&userId=other&account=other`),
            { headers: { 'X-User-Id': 'other' } }
          ),
          at(secret)
        )
      ).text()
    const calls = mocks.exportData.mock.calls as [
      string,
      { exportId: string },
    ][]
    expect(calls.map(([userId]) => userId)).toEqual(['owner', 'owner'])
    // A new id each time, and never the one the request asked for.
    const ids = calls.map(([, { exportId }]) => exportId)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain(chosen)
  })

  it('records the export under its own action, with the account as its target', async () => {
    const { secret } = transfer('export')
    await (await download(secret)).text()
    const events = await audited()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'mcp.transfer.export',
        category: 'mcp',
        outcome: 'success',
        status: 200,
        method: 'GET',
        route: TEMPLATE,
        actorId: 'owner',
        actorName: 'Alex',
        targetType: 'user',
        targetId: 'owner',
        targetName: 'Alex',
      }),
    ])
    expect(events[0].details).toMatchObject({ tokenId: 'token-1' })
    expect(JSON.stringify(events)).not.toContain(secret)
  })

  it('counts neither a view nor a download, and asks for no session', async () => {
    const { secret } = transfer('export')
    await (
      await download(secret, {
        headers: { Cookie: 'next-auth.session-token=signed-in-administrator' },
      })
    ).text()
    expect(mocks.countFile).not.toHaveBeenCalled()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  describe('once', () => {
    it('is gone once its download has ended, and the same command finds nothing', async () => {
      const { secret, row } = transfer('export')
      const response = await download(secret)
      // Taken as the export starts, and kept while it is sent.
      expect(row.claimedAt).toBeInstanceOf(Date)
      expect(state.transfers).toEqual([row])
      expect(await response.text()).toBe('PKzip')
      expect(state.transfers).toEqual([])
      await expectNotFound(await download(secret))
      expect(mocks.exportData).toHaveBeenCalledOnce()
    })

    it('refuses a second request with 409 while the first is still being sent', async () => {
      const { secret, row } = transfer('export')
      const { send } = slowExport()
      const sending = download(secret)
      await send('PK')
      const first = await sending
      const second = await download(secret)
      expect(await shape(second)).toEqual({
        status: 409,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
          'referrer-policy': 'no-referrer',
        },
        body: JSON.stringify({
          error:
            'This export URL is in use by another download, or was already used. If that download fails before it starts the URL can be used again; otherwise call export_account for a new one.',
        }),
      })
      // The refused request starts no export and leaves the first one's claim.
      expect(mocks.exportData).toHaveBeenCalledOnce()
      expect(row.claimedAt).toBeInstanceOf(Date)
      expect(state.transfers).toEqual([row])
      const reading = first.text()
      await send('zip')
      await send(null)
      expect(await reading).toBe('PKzip')
      expect(state.transfers).toEqual([])
    })

    it('goes to one of two requests that arrive together', async () => {
      const { secret } = transfer('export')
      const [first, second] = await Promise.all([
        download(secret),
        download(secret),
      ])
      expect([first.status, second.status].sort()).toEqual([200, 409])
      expect(mocks.exportData).toHaveBeenCalledOnce()
    })

    it('keeps the URL for the download that took it, long past the time it had to start', async () => {
      const { secret, row } = transfer('export', {
        expiresAt: new Date(Date.now() + 60_000),
      })
      const { send } = slowExport()
      const sending = download(secret)
      await send('PK')
      await sending
      const held = row.expiresAt.getTime() - Date.now()
      expect(held).toBeGreaterThan(23 * 3_600_000)
      expect(held).toBeLessThanOrEqual(24 * 3_600_000)
    })

    it('answers before the export is whole: it is read as it is sent', async () => {
      const { secret } = transfer('export')
      const { send } = slowExport()
      const sending = download(secret)
      // Nothing is answered until the export has begun to arrive.
      let answered = false
      void sending.then(() => (answered = true))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(answered).toBe(false)
      await send('PK')
      const response = await sending
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('PK')
      await send('more')
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('more')
      await send(null)
      expect((await reader.read()).done).toBe(true)
      expect(state.transfers).toEqual([])
    })
  })

  describe('when the export fails before a byte is sent', () => {
    it('gives the URL back with the time it had, so the same command can run again', async () => {
      const { secret, row } = transfer('export')
      mocks.exportData.mockRejectedValueOnce(new Error('storage unavailable'))
      const failed = await download(secret)
      expect(await shape(failed)).toEqual({
        status: 500,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
          'referrer-policy': 'no-referrer',
        },
        body: JSON.stringify({ error: 'The transfer could not be completed.' }),
      })
      expect(row.claimedAt).toBeNull()
      // Fifteen minutes from when it was made, not the day it was kept for.
      expect(row.expiresAt.getTime()).toBe(
        row.createdAt.getTime() + 15 * 60_000
      )
      expect(state.transfers).toEqual([row])
      const retried = await download(secret)
      expect(retried.status).toBe(200)
      expect(await retried.text()).toBe('PKzip')
      expect(mocks.exportData).toHaveBeenCalledTimes(2)
    })

    it('gives it back when the export breaks off as it is first read', async () => {
      const { secret, row } = transfer('export')
      mocks.exportData.mockResolvedValueOnce({
        filename: 'flare-data-export-1.zip',
        body: new ReadableStream<Uint8Array>({
          pull() {
            throw new Error('archive failed')
          },
        }),
      })
      expect((await download(secret)).status).toBe(500)
      expect(row.claimedAt).toBeNull()
      expect((await download(secret)).status).toBe(200)
    })

    it('gives it back when the export ends without sending anything', async () => {
      const { secret, row } = transfer('export')
      mocks.exportData.mockResolvedValueOnce(exportOf([]))
      expect((await download(secret)).status).toBe(500)
      expect(row.claimedAt).toBeNull()
      expect(state.transfers).toEqual([row])
    })

    it('records the failure, and that nothing was sent', async () => {
      const { secret } = transfer('export')
      mocks.exportData.mockRejectedValueOnce(new Error('storage unavailable'))
      await download(secret)
      expect(await audited()).toEqual([
        expect.objectContaining({
          action: 'mcp.transfer.export',
          outcome: 'failure',
          status: 500,
        }),
      ])
    })
  })

  describe('when the download breaks off part way', () => {
    it('is used up when the export fails after its first bytes', async () => {
      const { secret } = transfer('export')
      let pulls = 0
      mocks.exportData.mockResolvedValueOnce({
        filename: 'flare-data-export-1.zip',
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulls++) throw new Error('a file failed part way')
            controller.enqueue(new TextEncoder().encode('PK'))
          },
        }),
      })
      const response = await download(secret)
      expect(response.status).toBe(200)
      // The client sees a failed download, never a short archive that ends well.
      await expect(response.text()).rejects.toThrow('a file failed part way')
      expect(state.transfers).toEqual([])
      await expectNotFound(await download(secret))
    })

    it('is used up, and the export stopped, when the client gives up', async () => {
      const { secret } = transfer('export')
      const { send, cancelled } = slowExport()
      const sending = download(secret)
      await send('PK')
      const response = await sending
      await response.body!.cancel('client left')
      expect(cancelled).toHaveBeenCalledExactlyOnceWith('client left')
      expect(state.transfers).toEqual([])
      await expectNotFound(await download(secret))
    })
  })

  it('takes nothing for a HEAD, which only asks what is there', async () => {
    const { secret, row } = transfer('export')
    const response = await download(secret, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.body).toBeNull()
    expect(mocks.exportData).not.toHaveBeenCalled()
    expect(row.claimedAt).toBeNull()
    // The URL is still there for the download itself.
    expect(await (await download(secret)).text()).toBe('PKzip')
  })

  it('answers a HEAD as it would a GET while a download has the URL', async () => {
    const { secret, row } = transfer('export')
    row.claimedAt = new Date()
    const response = await download(secret, { method: 'HEAD' })
    expect(response.status).toBe(409)
    expect(mocks.exportData).not.toHaveBeenCalled()
  })
})

describe('uploading through a transfer URL', () => {
  /** What the upload code was handed on its only call. */
  const handed = () => {
    expect(mocks.directUpload).toHaveBeenCalledOnce()
    return mocks.directUpload.mock.calls[0] as [
      Request,
      { id: string; apiToken?: { id: string } },
      FixedUpload,
    ]
  }

  it('publishes the file with what the URL fixed and answers as the REST upload does', async () => {
    const { secret, row } = transfer('upload')
    const response = await upload(secret)
    expect(await shape(response)).toEqual({
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'referrer-policy': 'no-referrer',
      },
      body: JSON.stringify({ data: links, success: true }),
    })
    const [request, user, fixed] = handed()
    expect(request.method).toBe('POST')
    expect(user).toMatchObject({
      id: 'owner',
      credential: 'token',
      apiToken: { id: 'token-1', profileId: null },
    })
    expect(fixed).toEqual({ ...fixedUpload, authorize: expect.any(Function) })
    expect(row.claimedAt).toBeInstanceOf(Date)
    expect(mocks.consume).toHaveBeenCalledExactlyOnceWith('token:token-1')
  })

  it('records the upload under the account and token the URL was made for', async () => {
    const { secret } = transfer('upload')
    await upload(secret)
    const events = await audited()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'mcp.transfer.upload',
        category: 'mcp',
        outcome: 'success',
        status: 200,
        method: 'POST',
        route: TEMPLATE,
        actorId: 'owner',
      }),
    ])
    expect(events[0].details).toMatchObject({ tokenId: 'token-1' })
    expect(JSON.stringify(events)).not.toContain(secret)
  })

  it('hands the upload code only what the URL fixed, whatever the request adds', async () => {
    const { secret } = transfer('upload')
    await upload(secret, {
      fields: {
        visibility: 'PUBLIC',
        password: '',
        folderId: 'folder-other',
        profileId: 'profile-other',
        tagIds: '[]',
        expiration: 'DISABLED',
        filename: 'renamed.exe',
        isPaste: 'true',
      },
      headers: {
        'X-Upload-Profile': 'profile-other',
        'X-Upload-Folder': 'folder-other',
        'X-Flare-Paste': 'true',
      },
      query: '?profileId=profile-other&folderId=folder-other&visibility=PUBLIC',
    })
    const [, , fixed] = handed()
    // Exactly the row's values and the publishing check: no paste, no extras.
    expect(Object.keys(fixed).sort()).toEqual([
      'authorize',
      'filename',
      'options',
      'passwordHash',
    ])
    expect(fixed.options).toEqual(fixedUpload.options)
    expect(fixed.filename).toBe('report.pdf')
    expect(fixed.passwordHash).toBe(fixedUpload.passwordHash)
  })

  it('uploads with no options for a URL that fixed none', async () => {
    const { secret } = transfer('upload', { options: { options: {} } })
    await upload(secret)
    const [, , fixed] = handed()
    expect(fixed).toEqual({
      options: {},
      filename: undefined,
      passwordHash: undefined,
      authorize: expect.any(Function),
    })
  })

  it('refuses a second request with 409 while the first holds the URL', async () => {
    const { secret, row } = transfer('upload')
    let finish!: (value: typeof links) => void
    mocks.directUpload.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    )
    const first = upload(secret)
    await vi.waitFor(() => expect(mocks.directUpload).toHaveBeenCalledOnce())
    const second = await upload(secret)
    expect(await shape(second)).toEqual({
      status: 409,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'referrer-policy': 'no-referrer',
      },
      body: JSON.stringify({
        // It says both what may be true and what to do in either case.
        error:
          'This upload URL is in use by another upload, or was already used. If that upload fails the URL can be used again; otherwise call create_upload_url for a new one.',
      }),
    })
    // The refused request uploads nothing, spends nothing, and leaves the
    // first one's claim alone.
    expect(mocks.directUpload).toHaveBeenCalledOnce()
    expect(mocks.consume).toHaveBeenCalledOnce()
    expect(row.claimedAt).toBeInstanceOf(Date)
    finish(links)
    expect((await first).status).toBe(200)
  })

  it('claims with the write that only one request can win', async () => {
    const { secret } = transfer('upload')
    const [first, second] = await Promise.all([upload(secret), upload(secret)])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect(mocks.directUpload).toHaveBeenCalledOnce()
  })

  it('keeps the URL for the upload that took it, long past the time it had to start', async () => {
    const { secret, row } = transfer('upload', {
      expiresAt: new Date(Date.now() + 60_000),
    })
    let finish!: (value: typeof links) => void
    mocks.directUpload.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    )
    const sending = upload(secret)
    await vi.waitFor(() => expect(mocks.directUpload).toHaveBeenCalledOnce())
    // A day, so the sweep of expired URLs leaves it to a file still arriving.
    const held = row.expiresAt.getTime() - Date.now()
    expect(held).toBeGreaterThan(23 * 3_600_000)
    expect(held).toBeLessThanOrEqual(24 * 3_600_000)
    finish(links)
    expect((await sending).status).toBe(200)
  })

  it('gives a failed upload its URL back with the time it had, not the day it was kept for', async () => {
    const { secret, row } = transfer('upload')
    mocks.directUpload.mockRejectedValueOnce(new HttpError(413, 'Too large.'))
    expect((await upload(secret)).status).toBe(413)
    expect(row.claimedAt).toBeNull()
    // Fifteen minutes from when it was made.
    expect(row.expiresAt.getTime()).toBe(row.createdAt.getTime() + 15 * 60_000)
  })

  it('releases the URL when the upload fails, so the same command can run again', async () => {
    const { secret, row } = transfer('upload')
    mocks.directUpload.mockRejectedValueOnce(
      new HttpError(413, 'A file exceeds the upload size limit.')
    )
    const failed = await upload(secret)
    expect(await shape(failed)).toEqual({
      status: 413,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'referrer-policy': 'no-referrer',
      },
      body: JSON.stringify({ error: 'A file exceeds the upload size limit.' }),
    })
    expect(row.claimedAt).toBeNull()
    expect(state.transfers).toEqual([row])
    const retried = await upload(secret)
    expect(retried.status).toBe(200)
    expect(mocks.directUpload).toHaveBeenCalledTimes(2)
  })

  it('releases the URL after an unexpected failure, and hides what failed', async () => {
    const { secret, row } = transfer('upload')
    mocks.directUpload.mockRejectedValueOnce(new Error('storage on fire'))
    const response = await upload(secret)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Upload could not be completed.',
    })
    expect(row.claimedAt).toBeNull()
  })

  it('words a rejected upload option as the REST upload does', async () => {
    const { secret } = transfer('upload')
    mocks.directUpload.mockRejectedValueOnce(
      new HttpError(400, 'Expiration must be in the future.')
    )
    const response = await upload(secret)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Expiration must be in the future.',
    })
  })

  it('counts uploads against the limit of the credential, and releases a limited one', async () => {
    const { secret, row } = transfer('upload')
    mocks.consume.mockRejectedValueOnce({ msBeforeNext: 30_000 })
    const limited = await upload(secret)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(limited.headers.get('cache-control')).toBe('no-store')
    expect(await limited.json()).toEqual({ error: 'Too many requests' })
    expect(mocks.directUpload).not.toHaveBeenCalled()
    expect(row.claimedAt).toBeNull()
    expect((await upload(secret)).status).toBe(200)
  })

  describe('in the transaction that publishes the file', () => {
    /** A transaction client holding the token and settings as they are now. */
    function transaction(
      stored: Partial<typeof token> | null = {},
      enabled = true
    ) {
      const removed: string[] = []
      const tx = {
        apiToken: {
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
            stored && where.id === token.id ? { ...token, ...stored } : null
          ),
        },
        config: {
          findUnique: vi.fn(async () => ({
            value: { general: { mcp: { enabled } } },
          })),
        },
        agentTransfer: {
          deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
            // As the database answers: how many rows were there to remove.
            const before = state.transfers.length
            state.transfers = state.transfers.filter(
              (row) => row.id !== where.id
            )
            const count = before - state.transfers.length
            if (count) removed.push(where.id)
            return { count }
          }),
        },
      }
      return { tx: tx as unknown as Prisma.TransactionClient, removed, raw: tx }
    }

    /** The check the route handed the upload code for this URL. */
    async function publishCheck(secret: string) {
      let authorize!: NonNullable<FixedUpload['authorize']>
      mocks.directUpload.mockImplementationOnce(
        async (_request: Request, _user: unknown, fixed: FixedUpload) => {
          authorize = fixed.authorize!
          return links
        }
      )
      await upload(secret)
      return authorize
    }

    it('removes the URL with the publication, so it publishes one file', async () => {
      const { secret, row } = transfer('upload')
      const { tx, removed } = transaction()
      mocks.directUpload.mockImplementationOnce(
        async (_request: Request, _user: unknown, fixed: FixedUpload) => {
          await fixed.authorize!(tx)
          return links
        }
      )
      expect((await upload(secret)).status).toBe(200)
      expect(removed).toEqual([row.id])
      // Run again, the same command finds nothing.
      await expectNotFound(await upload(secret))
      expect(mocks.directUpload).toHaveBeenCalledOnce()
    })

    it('reads the token and the settings through the transaction only', async () => {
      const { secret } = transfer('upload')
      const authorize = await publishCheck(secret)
      const { tx, raw } = transaction()
      mocks.queries.mockClear()
      await expect(authorize(tx)).resolves.toBeUndefined()
      expect(raw.apiToken.findUnique).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'token-1' },
      })
      expect(raw.config.findUnique).toHaveBeenCalledOnce()
      expect(mocks.queries).not.toHaveBeenCalled()
    })

    it.each([
      ['the MCP server was turned off', {}, false],
      ['the token was revoked', { revokedAt: new Date() }, true],
      ['the token has expired', { expiresAt: new Date(Date.now() - 1) }, true],
      ['the token was deleted', null, true],
      [
        'the token no longer carries Agent access',
        { scopes: ['files:upload', 'files:read'] },
        true,
      ],
      [
        'the token lost the upload scope',
        { scopes: ['mcp', 'files:read', 'files:content'] },
        true,
      ],
    ] as const)('refuses when %s meanwhile', async (_what, stored, enabled) => {
      const { secret, row } = transfer('upload')
      const authorize = await publishCheck(secret)
      const { tx, removed } = transaction(
        stored as Partial<typeof token> | null,
        enabled
      )
      await expect(authorize(tx)).rejects.toMatchObject({
        status: 403,
        message:
          'This upload URL may no longer be used: its connection lost upload access, or the MCP server was turned off.',
      })
      // The URL stays, to be released with the failed upload.
      expect(removed).toEqual([])
      expect(state.transfers).toContain(row)
    })

    it('publishes nothing with a URL that is already gone, however good the token still is', async () => {
      const { secret } = transfer('upload')
      const authorize = await publishCheck(secret)
      const { tx, raw, removed } = transaction()
      // Removed since the upload started: with its credential, or by
      // another publication.
      state.transfers = []
      await expect(authorize(tx)).rejects.toMatchObject({
        status: 403,
        message:
          'This upload URL may no longer be used: its connection lost upload access, or the MCP server was turned off.',
      })
      expect(raw.agentTransfer.deleteMany).toHaveBeenCalledOnce()
      expect(removed).toEqual([])
    })

    it('publishes one file when two publications reach the same URL', async () => {
      const { secret, row } = transfer('upload')
      const authorize = await publishCheck(secret)
      const { tx, removed } = transaction()
      await expect(authorize(tx)).resolves.toBeUndefined()
      await expect(authorize(tx)).rejects.toMatchObject({ status: 403 })
      expect(removed).toEqual([row.id])
    })

    it('answers a refused publication 403 and gives the URL back', async () => {
      const { secret, row } = transfer('upload')
      const { tx } = transaction({ revokedAt: new Date() })
      mocks.directUpload.mockImplementationOnce(
        async (_request: Request, _user: unknown, fixed: FixedUpload) => {
          await fixed.authorize!(tx)
          return links
        }
      )
      const response = await upload(secret)
      expect(response.status).toBe(403)
      expect(row.claimedAt).toBeNull()
      expect(await audited()).toEqual([
        expect.objectContaining({
          action: 'mcp.transfer.upload',
          outcome: 'denied',
          status: 403,
        }),
      ])
    })
  })
})

describe('a transfer URL made for an agent that signed in', () => {
  const made = (kind: Kind) =>
    transfer(kind, { credential: 'connection:connection-1' })
  const send = (kind: Kind, secret: string) =>
    kind === 'upload' ? upload(secret) : download(secret)

  it('downloads for as long as the connection lives, and never reads a token', async () => {
    const { secret } = made('download')
    const response = await download(secret)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(mocks.queries).toHaveBeenCalledWith('agentConnection.findUnique')
    expect(mocks.queries).not.toHaveBeenCalledWith('apiToken.findUnique')
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it('records the transfer under the account and the connection it was made for', async () => {
    const { secret } = made('download')
    await (await download(secret)).arrayBuffer()
    expect(await audited()).toEqual([
      expect.objectContaining({
        action: 'mcp.transfer.download',
        category: 'mcp',
        outcome: 'success',
        actorId: 'owner',
        actorName: 'Alex',
        details: expect.objectContaining({
          tokenId: 'connection:connection-1',
        }),
      }),
    ])
  })

  it('uploads with a check that reads the connection again', async () => {
    const { secret } = made('upload')
    const response = await upload(secret)
    expect(response.status).toBe(200)
    const [, user, fixed] = mocks.directUpload.mock.calls[0]
    expect(user).toMatchObject({
      id: 'owner',
      credential: 'agent',
      agentConnection: { id: 'connection-1' },
    })
    expect(user).not.toHaveProperty('apiToken')
    expect(fixed).toEqual({ ...fixedUpload, authorize: expect.any(Function) })
  })

  it('does not depend on the access token it was made with: it holds the whole grant', async () => {
    // Whatever pair asked for the URL, the connection itself still uploads.
    const { secret } = made('upload')
    expect((await upload(secret)).status).toBe(200)
  })

  it('reads an archive entry and sends an export as the account behind the connection', async () => {
    const entry = made('archive-entry')
    expect((await download(entry.secret)).status).toBe(200)
    expect(mocks.readEntry.mock.calls[0][0]).toMatchObject({
      user: {
        id: 'owner',
        credential: 'agent',
        agentConnection: { id: 'connection-1' },
      },
      sessionVersion: 1,
    })
    const sent = made('export')
    expect(await (await download(sent.secret)).text()).toBe('PKzip')
    expect(mocks.exportData.mock.calls[0][0]).toBe('owner')
    expect(mocks.queries).not.toHaveBeenCalledWith('apiToken.findUnique')
  })

  describe.each(KINDS)('for a %s', (kind) => {
    const dies: Array<[string, () => void]> = [
      [
        'the agent is disconnected',
        () =>
          withConnection({
            revokedAt: new Date(),
            revokedReason: 'disconnected',
          }),
      ],
      [
        'the connection ends after a refresh token came back',
        () =>
          withConnection({ revokedAt: new Date(), revokedReason: 'replay' }),
      ],
      [
        'the account is signed out everywhere',
        () =>
          withConnection({
            revokedAt: new Date(),
            revokedReason: 'sessions-revoked',
          }),
      ],
      ['the connection was removed', () => (state.connections = [])],
      [
        'its permissions were edited down',
        () => withConnection({ scopes: ['files:read'] }),
      ],
      [
        'the connection belongs to another account now',
        () =>
          withConnection({
            userId: 'other',
            user: { ...account, id: 'other' },
          }),
      ],
      [
        'the account must verify its email first',
        () => mocks.verifyEmail.mockReturnValue(true),
      ],
      [
        'the role no longer allows it',
        () =>
          (state.everyone = DEFAULT_PERMISSIONS.filter(
            (permission) =>
              permission !== 'files.read' && permission !== 'files.upload'
          )),
      ],
      ['the MCP server is turned off', () => (state.enabled = false)],
    ]

    it.each(dies)('dies when %s', async (_what, arrange) => {
      const { secret } = made(kind)
      arrange()
      await expectNotFound(await send(kind, secret))
      expect(mocks.directUpload).not.toHaveBeenCalled()
      expect(mocks.readEntry).not.toHaveBeenCalled()
      expect(mocks.exportData).not.toHaveBeenCalled()
      const storage = state.storage as ReturnType<typeof memoryStorage>
      expect(storage.getFileStream).not.toHaveBeenCalled()
    })

    it('answers exactly as an unknown URL does once the agent is disconnected', async () => {
      const { secret } = made(kind)
      withConnection({ revokedAt: new Date() })
      const refused = await shape(await send(kind, secret))
      const unknown = await shape(await send(kind, newLinkToken()))
      expect(refused).toEqual(unknown)
      expect(await audited()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: `mcp.transfer.${kind}`,
            outcome: 'denied',
            status: 404,
          }),
        ])
      )
    })
  })

  it('is not served by a token that happens to share the id', async () => {
    const { secret } = transfer('download', {
      credential: 'connection:token-1',
    })
    await expectNotFound(await download(secret))
  })

  describe('in the transaction that publishes the file', () => {
    function transaction(
      stored: Partial<typeof connection> | null = {},
      enabled = true
    ) {
      const removed: string[] = []
      const tx = {
        // The connection's row lock, taken before it is read.
        $queryRaw: vi.fn(async () => []),
        agentConnection: {
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
            stored && where.id === connection.id
              ? { ...connection, ...stored }
              : null
          ),
        },
        apiToken: { findUnique: vi.fn() },
        config: {
          findUnique: vi.fn(async () => ({
            value: { general: { mcp: { enabled } } },
          })),
        },
        agentTransfer: {
          deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
            // As the database answers: how many rows were there to remove.
            const before = state.transfers.length
            state.transfers = state.transfers.filter(
              (row) => row.id !== where.id
            )
            const count = before - state.transfers.length
            if (count) removed.push(where.id)
            return { count }
          }),
        },
      }
      return { tx: tx as unknown as Prisma.TransactionClient, removed, raw: tx }
    }
    async function publishCheck(secret: string) {
      let authorize!: NonNullable<FixedUpload['authorize']>
      mocks.directUpload.mockImplementationOnce(
        async (_request: Request, _user: unknown, fixed: FixedUpload) => {
          authorize = fixed.authorize!
          return links
        }
      )
      await upload(secret)
      return authorize
    }

    it('reads the connection and the settings through the transaction only, and removes the URL', async () => {
      const { secret, row } = made('upload')
      const authorize = await publishCheck(secret)
      const { tx, raw, removed } = transaction()
      mocks.queries.mockClear()
      await expect(authorize(tx)).resolves.toBeUndefined()
      expect(raw.agentConnection.findUnique).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'connection-1' },
        select: { revokedAt: true, scopes: true, createdAt: true },
      })
      expect(raw.config.findUnique).toHaveBeenCalledOnce()
      // A connection is not a named token, and nothing outside the
      // transaction is asked.
      expect(raw.apiToken.findUnique).not.toHaveBeenCalled()
      expect(mocks.queries).not.toHaveBeenCalled()
      expect(removed).toEqual([row.id])
    })

    it.each([
      ['the MCP server was turned off', {}, false],
      [
        'the agent was disconnected',
        { revokedAt: new Date(), revokedReason: 'disconnected' },
        true,
      ],
      [
        'the account was signed out everywhere',
        { revokedAt: new Date(), revokedReason: 'sessions-revoked' },
        true,
      ],
      ['the connection was removed', null, true],
      [
        'its permissions lost uploading',
        { scopes: ['files:read', 'files:content'] },
        true,
      ],
      ['its permissions were emptied', { scopes: [] }, true],
    ] as const)(
      'refuses when %s while the file was arriving',
      async (_what, stored, enabled) => {
        const { secret, row } = made('upload')
        const authorize = await publishCheck(secret)
        const { tx, removed } = transaction(
          stored as Partial<typeof connection> | null,
          enabled
        )
        await expect(authorize(tx)).rejects.toMatchObject({
          status: 403,
          message:
            'This upload URL may no longer be used: its connection lost upload access, or the MCP server was turned off.',
        })
        expect(removed).toEqual([])
        expect(state.transfers).toContain(row)
      }
    )

    it("holds the connection's row before reading it, to the end of the transaction", async () => {
      const { secret } = made('upload')
      const authorize = await publishCheck(secret)
      const { tx, raw } = transaction()
      await authorize(tx)
      const [statement, id] = raw.$queryRaw.mock.calls[0] as unknown as [
        string[],
        string,
      ]
      expect(statement.join('?')).toBe(
        'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR SHARE'
      )
      expect(id).toBe('connection-1')
      const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
        mock.mock.invocationCallOrder[0]
      expect(order(raw.$queryRaw)).toBeLessThan(
        order(raw.agentConnection.findUnique)
      )
      // The connection, then the URL: the order ending a connection uses.
      expect(order(raw.agentConnection.findUnique)).toBeLessThan(
        order(raw.agentTransfer.deleteMany)
      )
    })

    it('publishes nothing with a URL that went with its connection, even if the connection read as live', async () => {
      const { secret } = made('upload')
      const authorize = await publishCheck(secret)
      const { tx, removed } = transaction()
      // Disconnecting deletes a connection's URLs.
      state.transfers = []
      await expect(authorize(tx)).rejects.toMatchObject({
        status: 403,
        message:
          'This upload URL may no longer be used: its connection lost upload access, or the MCP server was turned off.',
      })
      expect(removed).toEqual([])
    })

    it('answers a publication refused mid-upload 403, and publishes nothing', async () => {
      const { secret, row } = made('upload')
      const { tx } = transaction({ revokedAt: new Date() })
      mocks.directUpload.mockImplementationOnce(
        async (_request: Request, _user: unknown, fixed: FixedUpload) => {
          await fixed.authorize!(tx)
          return links
        }
      )
      const response = await upload(secret)
      expect(response.status).toBe(403)
      expect(row.claimedAt).toBeNull()
      expect(await audited()).toEqual([
        expect.objectContaining({
          action: 'mcp.transfer.upload',
          outcome: 'denied',
          status: 403,
        }),
      ])
    })
  })
})

describe('a download link made in moderator mode', () => {
  const moderators = {
    id: 'moderators',
    name: 'Moderators',
    description: '',
    color: '#000000',
    position: 1,
    systemKey: null,
    permissions: ['content.read'],
  }
  /** A moderator's token: the moderation scope, and a role that reads content. */
  const moderatorToken = {
    ...token,
    id: 'token-mod',
    userId: 'moderator',
    hash: hashApiToken('flr_ModeratorToken'),
    scopes: ['admin:content', 'mcp'],
    user: {
      ...account,
      id: 'moderator',
      name: 'Mo',
      urlId: 'mo',
      roles: [moderators],
    },
  }
  const withModerator = (override: Partial<typeof moderatorToken> = {}) => {
    state.tokens = [{ ...token }, { ...moderatorToken, ...override }]
  }
  /** A link the moderator made for a file of the account `owner`. */
  const moderated = (
    kind: 'download' | 'archive-entry',
    overrides: Partial<TransferRow> = {}
  ) =>
    transfer(kind, {
      userId: 'moderator',
      credential: 'token:token-mod',
      options:
        kind === 'archive-entry'
          ? { entry: ENTRY, moderating: 'owner' }
          : { moderating: 'owner' },
      ...overrides,
    })

  beforeEach(() => {
    withModerator()
    state.administration = true
    state.users.push({ id: 'moderator', sessionVersion: 3 })
    // Private and behind a password: a moderator still reads it.
    state.files = [
      { ...file, visibility: 'PRIVATE', password: '$2b$10$somehashsomehash' },
    ]
  })

  it("sends another account's file, without counting it or asking for a session or password", async () => {
    const { secret } = moderated('download')
    const response = await download(secret)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(mocks.countFile).not.toHaveBeenCalled()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it('records the moderator, the credential and the file of the other account', async () => {
    const { secret } = moderated('download')
    await (await download(secret)).arrayBuffer()
    expect(await audited()).toEqual([
      expect.objectContaining({
        action: 'mcp.transfer.download',
        outcome: 'success',
        actorId: 'moderator',
        targetType: 'file',
        targetId: 'file-1',
        details: expect.objectContaining({ tokenId: 'token-mod' }),
      }),
    ])
  })

  it('reads an entry through the reader everyone but the owner uses, as the moderator, never as the owner', async () => {
    const { secret } = moderated('archive-entry')
    const response = await download(secret)
    expect(response.status).toBe(200)
    expect(mocks.readEntry).not.toHaveBeenCalled()
    expect(mocks.readSharedEntry).toHaveBeenCalledTimes(1)
    const [access, entry, request, options] =
      mocks.readSharedEntry.mock.calls[0]
    expect(access).toEqual({
      file: expect.objectContaining({ id: 'file-1', userId: 'owner' }),
      // With the credential, so the reader's own check of the viewer keeps
      // the download recorded under the agent that made the link.
      viewer: { id: 'moderator', sessionVersion: 3, credential: 'token-mod' },
      verifiedPasswordHash: null,
      passwordChecked: false,
      authorize: expect.any(Function),
    })
    expect(entry).toEqual(ENTRY)
    expect(request).toBeInstanceOf(Request)
    expect(options).toEqual({ inline: false, requester: 'user:moderator' })
  })

  it.each([
    ['the token was revoked', { revokedAt: new Date() }, true],
    ['the token lost the moderation scope', { scopes: ['mcp'] }, true],
    ['administration through MCP was turned off', {}, false],
  ])(
    'answers the same 404 when %s while the entry was being read',
    async (_what, token, administration) => {
      // What the reader's locked recheck reads by then.
      const tx = {
        $queryRaw: vi.fn(async () => []),
        apiToken: {
          findUnique: async () => ({ ...moderatorToken, ...token }),
        },
        config: {
          findUnique: async () => ({
            value: {
              general: { mcp: { enabled: true, administration } },
            },
          }),
        },
        user: { findUnique: async () => ({ roles: [moderators] }) },
        role: { findUnique: async () => null },
      }
      mocks.readSharedEntry.mockImplementation(
        async (access: { authorize: (tx: unknown) => Promise<void> }) => {
          await access.authorize(tx)
          return entryAnswer()
        }
      )
      const { secret } = moderated('archive-entry')
      await expectNotFound(await download(secret))
      expect((await audited()).map(({ outcome }) => outcome as string)).toEqual(
        ['denied']
      )
    }
  )

  const deaths: Array<{ name: string; arrange: (row: TransferRow) => void }> = [
    {
      name: 'the connection lost the moderation scope',
      arrange: () => withModerator({ scopes: ['files:content', 'mcp'] }),
    },
    {
      name: "the role no longer reads other accounts' content",
      arrange: () =>
        withModerator({
          user: {
            ...moderatorToken.user,
            roles: [{ ...moderators, permissions: ['content.delete'] }],
          },
        }),
    },
    {
      name: 'administration through MCP was turned off',
      arrange: () => (state.administration = false),
    },
    {
      name: 'the token was revoked',
      arrange: () => withModerator({ revokedAt: new Date() }),
    },
    {
      name: 'the token lost Agent access',
      arrange: () => withModerator({ scopes: ['admin:content'] }),
    },
    {
      name: 'the file now belongs to another account',
      arrange: () => (state.files = [{ ...state.files[0], userId: 'third' }]),
    },
    {
      name: 'the file now belongs to the moderator',
      arrange: () =>
        (state.files = [{ ...state.files[0], userId: 'moderator' }]),
    },
    { name: 'the file was deleted', arrange: () => (state.files = []) },
    {
      name: 'the row names the account in a form no link was made with',
      arrange: (row) =>
        (row.options =
          row.kind === 'archive-entry'
            ? { entry: ENTRY, moderating: '' }
            : { moderating: 42 }),
    },
  ]

  describe.each(['download', 'archive-entry'] as const)('for a %s', (kind) => {
    it.each(deaths)('answers the same 404 once $name', async ({ arrange }) => {
      const { secret, row } = moderated(kind)
      arrange(row)
      await expectNotFound(await download(secret))
      const storage = state.storage as ReturnType<typeof memoryStorage>
      expect(storage.getFileStream).not.toHaveBeenCalled()
      expect(mocks.readEntry).not.toHaveBeenCalled()
      expect(mocks.readSharedEntry).not.toHaveBeenCalled()
    })

    it("is never satisfied by the owner's standing", async () => {
      // The file's own account, holding everything an owner link needs, and
      // a row that says it moderates that same account.
      const { secret } = transfer(kind, {
        options:
          kind === 'archive-entry'
            ? { entry: ENTRY, moderating: 'owner' }
            : { moderating: 'owner' },
      })
      await expectNotFound(await download(secret))
      expect(mocks.readEntry).not.toHaveBeenCalled()
      expect(mocks.readSharedEntry).not.toHaveBeenCalled()
    })

    it("never satisfies an owner link's recheck", async () => {
      // An owner-mode row for the moderator's credential, naming a file of
      // another account, and one naming a file of the moderator's own while
      // the credential holds nothing an owner link needs.
      const { secret } = transfer(kind, {
        userId: 'moderator',
        credential: 'token:token-mod',
      })
      await expectNotFound(await download(secret))
      state.files = [{ ...file, userId: 'moderator' }]
      await expectNotFound(await download(secret))
      expect(mocks.readEntry).not.toHaveBeenCalled()
      expect(mocks.readSharedEntry).not.toHaveBeenCalled()
    })
  })
})
