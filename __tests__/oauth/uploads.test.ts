import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import {
  type ToolContext,
  type ToolDefinition,
  ToolError,
} from '@/lib/mcp/tool'
import { uploadsTools } from '@/lib/mcp/tools/uploads'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'
import type { FixedUpload } from '@/lib/uploads/direct'

const mocks = vi.hoisted(() => ({
  directUpload: vi.fn(),
  createTransfer: vi.fn(),
  outside: vi.fn(),
}))
vi.mock('@/lib/uploads/direct', () => ({ directUpload: mocks.directUpload }))
vi.mock('@/lib/security/rate-limit', () => ({
  uploadLimiter: { consume: vi.fn(), points: 30 },
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    // Nothing outside the publishing transaction may decide.
    agentConnection: { findUnique: mocks.outside },
    apiToken: { findUnique: mocks.outside },
    user: {
      findUnique: async () => ({
        randomizeFileUrls: false,
        defaultFileExpiration: 'DISABLED',
        defaultFileExpirationAction: 'DELETE',
        defaultUploadProfileId: null,
      }),
    },
    uploadProfile: { findMany: async () => [], findFirst: async () => null },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRaw: async () => [],
        agentTransfer: {
          deleteMany: async () => ({ count: 0 }),
          count: async () => 0,
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
          quotas: { enabled: false, default: { value: 10, unit: 'MB' } },
        },
      },
    },
  }),
}))
vi.mock('@/lib/files/delivery', () => ({ findFile: vi.fn() }))
vi.mock('@/lib/folders/service', () => ({
  listFolders: async () => [],
  validateOwnedFolderId: async (_user: string, id: string | null) => id,
}))
vi.mock('@/lib/tags/manage', () => ({ listTags: async () => [] }))
vi.mock('@/lib/tags/service', () => ({
  validateOwnedTagIds: async (_user: string, ids: string[]) => ids,
}))

const ORIGIN = 'https://flare.test'
const account: Omit<AuthenticatedUser, 'credential'> = {
  id: 'owner',
  storageUsed: 0,
  urlId: 'owner',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
}
const signedIn: AuthenticatedUser = {
  ...account,
  credential: 'agent',
  agentConnection: { id: 'connection-1', scopes: ['files:upload'] },
}
const withToken: AuthenticatedUser = {
  ...account,
  credential: 'token',
  apiToken: { id: 'token-1', scopes: ['mcp', 'files:upload'], profileId: null },
}

function context(user: AuthenticatedUser): ToolContext {
  const principal: AgentPrincipal = {
    user,
    name: 'Alex',
    scopes: ['files:upload'],
    credentialKey: user.agentConnection
      ? `connection:${user.agentConnection.id}`
      : 'token:token-1',
    can: (permission) => hasPermission(user, permission),
  }
  return {
    principal,
    request: new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }),
    origin: ORIGIN,
    allows: () => true,
    recheck: async () => {},
    requireEffect: () => {},
  }
}
const tool = (name: string) =>
  uploadsTools.find(
    (candidate) => candidate.name === name
  ) as unknown as ToolDefinition
const call = (name: string, args: Record<string, unknown>, user = signedIn) =>
  tool(name).run(tool(name).input.parse(args), context(user))

const links = {
  id: 'file-new',
  name: 'notes.txt',
  type: 'text/plain',
  size: 5,
  pageUrl: `${ORIGIN}/owner/notes.txt`,
  rawUrl: `${ORIGIN}/api/files/owner/notes.txt`,
  downloadUrl: `${ORIGIN}/api/files/file-new/download`,
}

/** A transaction client that sees the connection as it stands at publication. */
function transaction(
  stored: { revokedAt?: Date | null; scopes?: string[] } | null = {}
) {
  const findUnique = vi.fn(async () =>
    stored ? { revokedAt: null, scopes: ['files:upload'], ...stored } : null
  )
  /** The row lock, which the check takes before it reads. */
  const lock = vi.fn(async () => [])
  return {
    tx: { $queryRaw: lock, agentConnection: { findUnique } } as never,
    findUnique,
    lock,
  }
}

const inline = [
  ['upload_file', { filename: 'notes.txt', text: 'hello' }],
  ['create_paste', { content: 'hello' }],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.directUpload.mockResolvedValue(links)
  mocks.createTransfer.mockResolvedValue({})
})

describe.each(inline)('%s by an agent that signed in', (name, args) => {
  /** The check the tool handed the upload code. */
  async function publishCheck() {
    await call(name, args)
    const fixed: FixedUpload = mocks.directUpload.mock.calls[0][2]
    expect(fixed.authorize).toEqual(expect.any(Function))
    return fixed.authorize!
  }

  it('uploads as the account, with the connection as its credential', async () => {
    await call(name, args)
    const [, user] = mocks.directUpload.mock.calls[0]
    expect(user).toMatchObject({
      id: 'owner',
      credential: 'agent',
      agentConnection: { id: 'connection-1' },
    })
    expect(user).not.toHaveProperty('apiToken')
  })

  it('reads the connection again in the transaction that publishes, and nowhere else', async () => {
    const authorize = await publishCheck()
    const { tx, findUnique, lock } = transaction()
    await expect(authorize(tx)).resolves.toBeUndefined()
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'connection-1' },
      select: { revokedAt: true, scopes: true },
    })
    expect(mocks.outside).not.toHaveBeenCalled()
    // Its row is held first, to the end of the transaction: disconnecting it
    // or taking uploading away waits for the file, or was seen by this read.
    const [statement, id] = lock.mock.calls[0] as unknown as [string[], string]
    expect(statement.join('?')).toBe(
      'SELECT "id" FROM "AgentConnection" WHERE "id" = ? FOR SHARE'
    )
    expect(id).toBe('connection-1')
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0]
    )
  })

  it.each([
    [
      'the agent was disconnected',
      { revokedAt: new Date('2026-11-21T12:00:00.000Z') },
    ],
    ['the connection was removed', null],
    ['its permissions lost uploading', { scopes: ['files:read'] }],
    ['its permissions were emptied', { scopes: [] }],
  ])('publishes nothing when %s meanwhile', async (_what, stored) => {
    const authorize = await publishCheck()
    const refusal = await authorize(transaction(stored).tx).then(
      () => null,
      (error: unknown) => error
    )
    expect(refusal).toBeInstanceOf(ToolError)
    expect((refusal as ToolError).outcome).toBe('denied')
    expect((refusal as ToolError).message).toBe(
      'This connection was disconnected, or lost upload access, while the file was being uploaded. Nothing was published.'
    )
  })

  it('fails the call when the publication is refused', async () => {
    mocks.directUpload.mockImplementationOnce(
      async (_request: Request, _user: unknown, fixed: FixedUpload) => {
        await fixed.authorize!(transaction({ revokedAt: new Date() }).tx)
        return links
      }
    )
    await expect(call(name, args)).rejects.toBeInstanceOf(ToolError)
  })
})

describe.each(inline)('%s by a named token', (name, args) => {
  it('hands the upload code no check of its own: the upload reads the token again itself', async () => {
    await call(name, args, withToken)
    const fixed: FixedUpload = mocks.directUpload.mock.calls[0][2]
    expect(fixed).not.toHaveProperty('authorize')
    expect(Object.keys(fixed).sort()).toEqual([
      'filename',
      'isPaste',
      'options',
    ])
  })
})

describe('create_upload_url by an agent that signed in', () => {
  it('makes the URL for the connection, so it outlives a refresh and dies with a disconnect', async () => {
    const answer = await call('create_upload_url', {})
    expect(mocks.createTransfer).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        userId: 'owner',
        credential: 'connection:connection-1',
        kind: 'upload',
      }),
    })
    expect((answer.structured as { upload_url: string }).upload_url).toMatch(
      /^https:\/\/flare\.test\/api\/mcp\/transfer\/[A-Za-z0-9_-]{43}$/
    )
  })
})
