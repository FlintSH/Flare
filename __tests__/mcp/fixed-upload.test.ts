import { Readable } from 'node:stream'
import { crc32 } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { HttpError } from '@/lib/http/errors'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import type { ToolContext } from '@/lib/mcp/tool'
import { uploadsTools } from '@/lib/mcp/tools/uploads'
import type { UploadTransfer } from '@/lib/mcp/transfer'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'
import { type FixedUpload, directUpload } from '@/lib/uploads/direct'

/**
 * `directUpload` with options fixed by its caller, as the MCP tools and the
 * transfer URL call it, through the real publishing code up to the database.
 */
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  profile: vi.fn(),
  folder: vi.fn(),
  uploadStream: vi.fn(),
  deleteFile: vi.fn(),
  /** The bytes storage holds, which the type check reads back. */
  stored: { bytes: Buffer.alloc(0) },
  transaction: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    config: { findUnique: vi.fn() },
    role: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    file: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    vaultFolder: { findFirst: vi.fn() },
    apiToken: { findUnique: vi.fn() },
    uploadProfile: { findFirst: vi.fn() },
    // Where an upload URL is kept between being made and being used.
    agentTransfer: { deleteMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    // The job that applies an expiry when its time comes.
    event: { create: vi.fn() },
  },
}))
const settings = vi.hoisted(() => ({
  customization: { published: { sharing: { defaultStyle: 'framed' } } },
  general: {
    storage: {
      maxUploadSize: { value: 1, unit: 'MB' },
      quotas: { enabled: false, default: { value: 1, unit: 'MB' } },
    },
  },
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    user: { findUnique: mocks.account },
    uploadProfile: { findFirst: mocks.profile },
    vaultFolder: { findFirst: mocks.folder },
    file: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({ settings }),
  readConfig: async () => ({ settings }),
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    kind: 'local',
    target: { provider: 'local' },
    uploadStream: mocks.uploadStream,
    deleteFile: mocks.deleteFile,
    getFileStream: async (
      _path: string,
      range?: { start?: number; end?: number }
    ) =>
      Readable.from([
        mocks.stored.bytes.subarray(
          range?.start ?? 0,
          (range?.end ?? mocks.stored.bytes.length - 1) + 1
        ),
      ]),
  }),
}))
vi.mock('@/lib/tags/service', () => ({
  applyProfileTags: vi.fn(),
  applyAutomaticTags: vi.fn(),
  validateOwnedTagIds: async (_user: string, ids: string[]) => ids,
  TagError: class extends Error {},
}))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueFileReady: vi.fn() }))
// Images are queued for OCR once published; the queue answers with a promise.
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: vi.fn(async () => {}) } }))

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

/** Everything a request can say about an upload, all of it at odds with `fixed`. */
const LOUD = {
  fields: {
    visibility: 'PUBLIC',
    password: 'request-password',
    folderId: 'folder-request',
    profileId: 'profile-request',
    randomizeFileUrls: 'true',
    expiration: 'HOUR',
    expiryAction: 'SET_PRIVATE',
    // Over REST this alone is a 400.
    tagIds: 'not json',
    unknownField: 'x',
  },
  headers: {
    'X-Upload-Profile': 'profile-header',
    'X-Upload-Folder': 'folder-header',
    'X-Flare-Paste': 'true',
  },
  // Over REST a header and a query that disagree are a 400 too.
  query: '?profileId=profile-query&folderId=folder-query',
}

async function request({
  fields = {},
  headers = {},
  query = '',
  name = 'shot.txt',
  body = 'screenshot',
  type = 'text/plain',
}: {
  fields?: Record<string, string>
  headers?: Record<string, string>
  query?: string
  name?: string
  /** The file's bytes, and the type its sender claims for them. */
  body?: string | Buffer
  type?: string
} = {}) {
  const form = new FormData()
  for (const [field, value] of Object.entries(fields)) form.set(field, value)
  form.set(
    'file',
    new Blob([typeof body === 'string' ? body : new Uint8Array(body)], {
      type,
    }),
    name
  )
  const encoded = new Response(form)
  return new Request(`http://flare.internal/api/files${query}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': encoded.headers.get('content-type')!,
    },
    body: new Uint8Array(await encoded.arrayBuffer()),
  })
}

/** The file row the upload wrote. */
const created = () => {
  expect(mocks.tx.file.create).toHaveBeenCalledOnce()
  return mocks.tx.file.create.mock.calls[0][0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.account.mockResolvedValue({
    randomizeFileUrls: false,
    defaultFileExpiration: 'DISABLED',
    defaultFileExpirationAction: 'DELETE',
    defaultUploadProfileId: null,
  })
  mocks.profile.mockImplementation(
    async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      options: {},
      updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    })
  )
  mocks.folder.mockImplementation(
    async ({ where }: { where: { id: string } }) => ({ id: where.id })
  )
  mocks.stored.bytes = Buffer.alloc(0)
  mocks.uploadStream.mockImplementation(async (stream: Readable) => {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
    mocks.stored.bytes = Buffer.concat(chunks)
    return { size: mocks.stored.bytes.length }
  })
  mocks.transaction.mockImplementation((callback) => callback(mocks.tx))
  mocks.tx.config.findUnique.mockResolvedValue(null)
  mocks.tx.user.findUnique.mockResolvedValue({
    id: 'owner',
    urlId: 'owner',
    storageUsed: 0,
    roles: [],
  })
  mocks.tx.role.findUnique.mockResolvedValue({
    id: 'everyone',
    name: 'Everyone',
    position: 0,
    systemKey: 'everyone',
    permissions: [...DEFAULT_PERMISSIONS],
  })
  mocks.tx.file.findFirst.mockResolvedValue(null)
  mocks.tx.file.findUnique.mockResolvedValue(null)
  mocks.tx.vaultFolder.findFirst.mockImplementation(
    async ({ where }: { where: { id: string } }) => ({ id: where.id })
  )
  mocks.tx.apiToken.findUnique.mockResolvedValue({
    id: 'token-1',
    revokedAt: null,
    expiresAt: null,
    profileId: null,
  })
  mocks.tx.file.create.mockImplementation(async ({ data }) => ({
    id: 'file-1',
    size: 0.00001,
    ...data,
  }))
  mocks.tx.agentTransfer.deleteMany.mockResolvedValue({ count: 0 })
  mocks.tx.agentTransfer.count.mockResolvedValue(0)
  mocks.tx.agentTransfer.create.mockResolvedValue({})
  mocks.tx.event.create.mockResolvedValue({})
  // Scheduling an expiry writes an audit entry; nothing here reads it.
  configureAuditWriter(async () => {})
})

describe('an upload whose options its caller fixed', () => {
  it('publishes with the fixed options and ignores headers, query and form fields', async () => {
    const answer = await directUpload(await request(LOUD), user, {
      options: {
        visibility: 'PRIVATE',
        folderId: 'folder-fixed',
        profileId: 'profile-fixed',
      },
    })
    expect(created()).toMatchObject({
      name: 'shot.txt',
      visibility: 'PRIVATE',
      folderId: 'folder-fixed',
      isPaste: false,
      password: null,
      userId: 'owner',
      urlPath: '/owner/shot.txt',
      uploadOptions: expect.objectContaining({
        visibility: 'PRIVATE',
        profileId: 'profile-fixed',
        randomizeFileUrls: false,
        expiration: 'DISABLED',
        expiryAction: 'DELETE',
        tagIds: [],
        expiresAt: null,
      }),
    })
    // Only the fixed profile and folder were ever looked up.
    expect(mocks.profile.mock.calls.map(([query]) => query.where.id)).toEqual([
      'profile-fixed',
    ])
    expect(mocks.folder.mock.calls.map(([query]) => query.where.id)).toEqual([
      'folder-fixed',
    ])
    // A caller that fixes the options is told which file it made.
    expect(answer).toMatchObject({ id: 'file-1', name: 'shot.txt' })
  })

  it('uses the account defaults for every option the caller left out', async () => {
    mocks.account.mockResolvedValue({
      randomizeFileUrls: false,
      defaultFileExpiration: 'DISABLED',
      defaultFileExpirationAction: 'DELETE',
      defaultUploadProfileId: 'profile-default',
    })
    await directUpload(await request(LOUD), user, { options: {} })
    expect(created()).toMatchObject({
      visibility: 'PUBLIC',
      folderId: null,
      isPaste: false,
      password: null,
      uploadOptions: expect.objectContaining({ profileId: 'profile-default' }),
    })
  })

  it('names the file as the caller says, before its address is chosen', async () => {
    await directUpload(await request({ name: 'from-disk.bin' }), user, {
      options: {},
      filename: 'Quarterly "final" report.txt',
    })
    expect(created()).toMatchObject({
      name: 'Quarterly "final" report.txt',
      urlPath: '/owner/quarterly-final-report.txt',
    })
    expect(created().path).toMatch(
      /^uploads\/owner\/[0-9a-f-]{36}\/quarterly-final-report\.txt$/
    )
    expect(mocks.uploadStream).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      created().path,
      'text/plain'
    )
  })

  it('keeps only the last component of a fixed name, and refuses one that is no name', async () => {
    await directUpload(await request(), user, {
      options: {},
      filename: '../../etc/pass\u0000wd',
    })
    expect(created().name).toBe('passwd')
    mocks.tx.file.create.mockClear()
    mocks.uploadStream.mockClear()
    for (const filename of ['', '..', 'folder/', '\u0001'])
      await expect(
        directUpload(await request(), user, { options: {}, filename })
      ).rejects.toMatchObject({ status: 400, message: 'Invalid filename.' })
    expect(mocks.uploadStream).not.toHaveBeenCalled()
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })

  it('makes a paste only when the caller says so, and only for a role that may', async () => {
    await directUpload(await request(LOUD), user, {
      options: {},
      isPaste: true,
    })
    expect(created().isPaste).toBe(true)
    const noPastes = {
      ...user,
      permissions: DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'pastes.create'
      ),
    }
    await expect(
      directUpload(await request(), noPastes, { options: {}, isPaste: true })
    ).rejects.toMatchObject({
      status: 403,
      message: 'You do not have permission to create pastes.',
    })
    // The header alone asks for nothing, so that role may still upload.
    mocks.tx.file.create.mockClear()
    await directUpload(await request(LOUD), noPastes, { options: {} })
    expect(created().isPaste).toBe(false)
  })

  it('stores a prepared password hash as it is, or hashes a password given in the options', async () => {
    const hash = '$2b$10$preparedhashpreparedhashpreparedhashpreparedhashprepar'
    await directUpload(await request(LOUD), user, {
      options: {},
      passwordHash: hash,
    })
    expect(created().password).toBe(hash)
    mocks.tx.file.create.mockClear()
    await directUpload(await request(LOUD), user, {
      options: { password: 'correct horse' },
    })
    expect(created().password).toMatch(/^\$2[aby]\$10\$/)
    expect(created().password).not.toContain('correct horse')
    expect(JSON.stringify(created().uploadOptions)).not.toContain('correct')
  })

  it('keeps a token bound to its upload profile', async () => {
    const bound = {
      ...user,
      apiToken: { ...user.apiToken!, profileId: 'profile-bound' },
    }
    await expect(
      directUpload(await request(), bound, {
        options: { profileId: 'profile-other' },
      })
    ).rejects.toMatchObject({
      status: 403,
      message: 'This token is restricted to its upload profile.',
    })
    expect(mocks.uploadStream).not.toHaveBeenCalled()
  })

  it('refuses options the request schema does not know', async () => {
    await expect(
      directUpload(await request(), user, {
        options: { isAdmin: true } as FixedUpload['options'],
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(mocks.uploadStream).not.toHaveBeenCalled()
  })

  describe('with a check of its own', () => {
    it('runs the check in the publishing transaction, after the token is read again and before the file exists', async () => {
      const authorize = vi.fn(async () => {})
      await directUpload(await request(), user, { options: {}, authorize })
      expect(authorize).toHaveBeenCalledExactlyOnceWith(mocks.tx)
      const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
        mock.mock.invocationCallOrder[0]
      expect(order(mocks.tx.apiToken.findUnique)).toBeLessThan(order(authorize))
      expect(order(authorize)).toBeLessThan(order(mocks.tx.file.create))
      expect(order(authorize)).toBeLessThan(order(mocks.tx.user.update))
    })

    it('publishes nothing and removes the stored bytes when the check refuses', async () => {
      const refusal = new HttpError(403, 'No longer allowed.')
      await expect(
        directUpload(await request(), user, {
          options: {},
          authorize: async () => {
            throw refusal
          },
        })
      ).rejects.toBe(refusal)
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
      expect(mocks.deleteFile).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^uploads\/owner\/[0-9a-f-]{36}\/shot\.txt$/)
      )
    })

    it('never reaches the check for a token that was revoked meanwhile', async () => {
      mocks.tx.apiToken.findUnique.mockResolvedValue({
        id: 'token-1',
        revokedAt: new Date(),
        expiresAt: null,
        profileId: null,
      })
      const authorize = vi.fn(async () => {})
      await expect(
        directUpload(await request(), user, { options: {}, authorize })
      ).rejects.toMatchObject({
        status: 403,
        message: 'Upload token has expired or been revoked.',
      })
      expect(authorize).not.toHaveBeenCalled()
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
    })
  })
})

describe('an upload URL made earlier', () => {
  type Profile = { options: Record<string, unknown>; updatedAt: Date }
  /** The account's upload profiles and its defaults, as they stand right now. */
  let profiles: Record<string, Profile>
  let account: {
    randomizeFileUrls: boolean
    defaultFileExpiration: string
    defaultFileExpirationAction: string
    defaultUploadProfileId: string | null
  }
  const profile = (options: Record<string, unknown>): Profile => ({
    options,
    updatedAt: new Date(),
  })
  const bound: AuthenticatedUser = {
    ...user,
    apiToken: { ...user.apiToken!, profileId: 'profile-bound' },
  }

  beforeEach(() => {
    profiles = {}
    account = {
      randomizeFileUrls: false,
      defaultFileExpiration: 'DISABLED',
      defaultFileExpirationAction: 'DELETE',
      defaultUploadProfileId: null,
    }
    mocks.account.mockImplementation(async () => ({ ...account }))
    const find = async ({ where }: { where: { id: string } }) =>
      profiles[where.id] ? { id: where.id, ...profiles[where.id] } : null
    mocks.profile.mockImplementation(find)
    mocks.tx.uploadProfile.findFirst.mockImplementation(find)
  })

  /** `create_upload_url`, answering what its row keeps. */
  async function makeUrl(
    args: Record<string, unknown> = {},
    who: AuthenticatedUser = user
  ): Promise<UploadTransfer> {
    const principal: AgentPrincipal = {
      user: who,
      name: 'Alex',
      scopes: ['files:upload'],
      credentialKey: 'token:token-1',
      can: (permission) => hasPermission(who, permission),
    }
    const context: ToolContext = {
      principal,
      request: new Request('https://flare.test/api/mcp', { method: 'POST' }),
      origin: 'https://flare.test',
      moderating: null,
      mayModerate: false,
      requireModeration: () => {},
      allows: () => true,
      recheck: async () => {},
      requireEffect: () => {},
    }
    const tool = uploadsTools.find(({ name }) => name === 'create_upload_url')!
    mocks.tx.agentTransfer.create.mockClear()
    await tool.run(tool.input.parse(args) as never, context)
    expect(mocks.tx.agentTransfer.create).toHaveBeenCalledOnce()
    const row = mocks.tx.agentTransfer.create.mock.calls[0][0].data
    expect(row.kind).toBe('upload')
    // As the database gives the JSON back.
    return JSON.parse(JSON.stringify(row.options))
  }

  /** The upload the transfer route runs for a stored URL. */
  async function useUrl(stored: UploadTransfer, who: AuthenticatedUser = user) {
    if (who.apiToken?.profileId)
      mocks.tx.apiToken.findUnique.mockResolvedValue({
        id: 'token-1',
        revokedAt: null,
        expiresAt: null,
        profileId: who.apiToken.profileId,
      })
    return directUpload(await request(), who, {
      options: stored.options,
      filename: stored.filename,
      passwordHash: stored.passwordHash,
    })
  }

  it('keeps the visibility its profile gave it when the profile is made public before the upload', async () => {
    profiles['profile-default'] = profile({ visibility: 'PRIVATE' })
    account.defaultUploadProfileId = 'profile-default'
    const stored = await makeUrl()
    expect(stored.options).toMatchObject({
      visibility: 'PRIVATE',
      profileId: 'profile-default',
    })

    // A minute later someone makes the profile public.
    profiles['profile-default'] = profile({ visibility: 'PUBLIC' })
    await useUrl(stored)
    expect(created()).toMatchObject({
      visibility: 'PRIVATE',
      uploadOptions: expect.objectContaining({
        visibility: 'PRIVATE',
        profileId: 'profile-default',
      }),
    })

    // An upload that fixed nothing follows the profile as it now is.
    mocks.tx.file.create.mockClear()
    await directUpload(await request(), user, { options: {} })
    expect(created().visibility).toBe('PUBLIC')
  })

  it('keeps a public file public when its profile is made private before the upload', async () => {
    profiles['profile-default'] = profile({ visibility: 'PUBLIC' })
    account.defaultUploadProfileId = 'profile-default'
    const stored = await makeUrl()
    profiles['profile-default'] = profile({ visibility: 'PRIVATE' })
    await useUrl(stored)
    expect(created().visibility).toBe('PUBLIC')
  })

  it.each([
    ['another profile, a public one', 'profile-public'],
    ['no profile at all', null],
  ])(
    "keeps its visibility and its profile when the account's default becomes %s",
    async (_what, next) => {
      profiles['profile-private'] = profile({ visibility: 'PRIVATE' })
      profiles['profile-public'] = profile({ visibility: 'PUBLIC' })
      account.defaultUploadProfileId = 'profile-private'
      const stored = await makeUrl()

      account.defaultUploadProfileId = next
      await useUrl(stored)
      expect(created()).toMatchObject({
        visibility: 'PRIVATE',
        uploadOptions: expect.objectContaining({
          profileId: 'profile-private',
        }),
      })
    }
  )

  it('keeps "no profile" when the account gains a default profile before the upload', async () => {
    const stored = await makeUrl({ visibility: 'private' })
    expect(stored.options).toMatchObject({ profileId: null })
    profiles['profile-public'] = profile({
      visibility: 'PUBLIC',
      tagIds: ['tag-added'],
    })
    account.defaultUploadProfileId = 'profile-public'
    await useUrl(stored)
    expect(created()).toMatchObject({
      visibility: 'PRIVATE',
      uploadOptions: expect.objectContaining({ profileId: null, tagIds: [] }),
    })
  })

  it('keeps its naming, expiry and share style when the account defaults change before the upload', async () => {
    const stored = await makeUrl()
    expect(stored.options).toMatchObject({
      randomizeFileUrls: false,
      expiration: 'DISABLED',
    })
    expect(stored.options).not.toHaveProperty('expiresAt')
    account.randomizeFileUrls = true
    account.defaultFileExpiration = 'HOUR'
    account.defaultFileExpirationAction = 'SET_PRIVATE'
    await useUrl(stored)
    expect(created()).toMatchObject({
      // Not the random name the account now gives new uploads.
      urlPath: '/owner/shot.txt',
      uploadOptions: expect.objectContaining({
        randomizeFileUrls: false,
        expiration: 'DISABLED',
        expiryAction: 'DELETE',
        expiresAt: null,
      }),
    })
    // No expiry, so no job to apply one.
    expect(mocks.tx.event.create).not.toHaveBeenCalled()
  })

  describe('with an expiry', () => {
    const MADE = new Date('2026-11-21T12:00:00.000Z')
    const MINUTE = 60_000
    const HOUR = 60 * MINUTE
    /** The upload arrives twelve minutes after the URL was made. */
    const UPLOADED = new Date(MADE.getTime() + 12 * MINUTE)
    const after = (from: Date, hours: number) =>
      new Date(from.getTime() + hours * HOUR)

    beforeEach(() => {
      // Only the clock: the upload itself still runs on real timers.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(MADE)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    /** When the file the upload made expires, and what the job will do then. */
    const expiry = () => {
      const { uploadOptions } = created()
      expect(mocks.tx.event.create).toHaveBeenCalledOnce()
      const job = mocks.tx.event.create.mock.calls[0][0].data
      // The file's own record and the job that applies it say the same time.
      expect(job.scheduledAt.toISOString()).toBe(uploadOptions.expiresAt)
      expect(job.payload).toMatchObject({
        fileId: 'file-1',
        expiresAt: uploadOptions.expiresAt,
        action: uploadOptions.expiryAction,
      })
      return {
        at: uploadOptions.expiresAt as string,
        action: uploadOptions.expiryAction as string,
        length: uploadOptions.expiration as string,
      }
    }

    it.each<[string, () => Record<string, unknown>, string, number]>([
      ['the caller asked for', () => ({ expires_in: 'hour' }), 'HOUR', 1],
      [
        "the account's default profile sets",
        () => {
          profiles['profile-default'] = profile({ expiration: 'DAY' })
          account.defaultUploadProfileId = 'profile-default'
          return {}
        },
        'DAY',
        24,
      ],
      [
        'the account default sets',
        () => {
          account.defaultFileExpiration = 'WEEK'
          return {}
        },
        'WEEK',
        168,
      ],
    ])(
      'counts a length of time %s from the upload, not from the making of the URL',
      async (_source, prepare, length, hours) => {
        const stored = await makeUrl(prepare())
        // The length is what the row keeps, and no time.
        expect(stored.options).toMatchObject({ expiration: length })
        expect(stored.options).not.toHaveProperty('expiresAt')

        vi.setSystemTime(UPLOADED)
        await useUrl(stored)
        expect(expiry()).toMatchObject({
          at: after(UPLOADED, hours).toISOString(),
          length,
        })
        expect(expiry().at).not.toBe(after(MADE, hours).toISOString())
      }
    )

    it('counts a month from the upload too', async () => {
      const stored = await makeUrl({ expires_in: 'month' })
      vi.setSystemTime(UPLOADED)
      await useUrl(stored)
      // One calendar month after 21 November, 12:12 UTC.
      expect(expiry().at).toBe('2026-12-21T12:12:00.000Z')
    })

    it('keeps a time the caller stated exactly, whenever the upload happens', async () => {
      const stated = '2026-11-22T09:30:00+02:00'
      const stored = await makeUrl({ expires_at: stated })
      expect(stored.options).toMatchObject({ expiresAt: stated })

      vi.setSystemTime(UPLOADED)
      await useUrl(stored)
      // The same instant, written in UTC.
      expect(expiry().at).toBe('2026-11-22T07:30:00.000Z')
      expect(new Date(expiry().at).getTime()).toBe(new Date(stated).getTime())
    })

    it('keeps a stated time though the account default is a length of time', async () => {
      account.defaultFileExpiration = 'HOUR'
      const stored = await makeUrl({ expires_at: '2027-01-01T00:00:00Z' })
      vi.setSystemTime(UPLOADED)
      await useUrl(stored)
      expect(expiry().at).toBe('2027-01-01T00:00:00.000Z')
    })

    it.each([
      ['shortened to an hour', 'HOUR'],
      ['lengthened to a month', 'MONTH'],
      ['turned off', 'DISABLED'],
    ])(
      "keeps the week it was made with when the account's default length is %s before the upload",
      async (_what, next) => {
        account.defaultFileExpiration = 'WEEK'
        account.defaultFileExpirationAction = 'SET_PRIVATE'
        const stored = await makeUrl()

        account.defaultFileExpiration = next
        account.defaultFileExpirationAction = 'DELETE'
        vi.setSystemTime(UPLOADED)
        await useUrl(stored)
        expect(expiry()).toEqual({
          at: after(UPLOADED, 168).toISOString(),
          length: 'WEEK',
          // What happens at the end is as fixed as the length.
          action: 'SET_PRIVATE',
        })
      }
    )

    it("keeps the day its profile gave it when the profile's length changes before the upload", async () => {
      profiles['profile-default'] = profile({ expiration: 'DAY' })
      account.defaultUploadProfileId = 'profile-default'
      const stored = await makeUrl()
      profiles['profile-default'] = profile({ expiration: 'HOUR' })
      vi.setSystemTime(UPLOADED)
      await useUrl(stored)
      expect(expiry()).toMatchObject({
        at: after(UPLOADED, 24).toISOString(),
        length: 'DAY',
      })
    })

    it('keeps "never" when the account gains a default expiry before the upload', async () => {
      account.defaultFileExpiration = 'DAY'
      const stored = await makeUrl({ expires_in: 'never' })
      expect(stored.options).toMatchObject({ expiration: 'DISABLED' })
      account.defaultFileExpiration = 'HOUR'
      vi.setSystemTime(UPLOADED)
      await useUrl(stored)
      expect(created().uploadOptions).toMatchObject({
        expiration: 'DISABLED',
        expiresAt: null,
      })
      expect(mocks.tx.event.create).not.toHaveBeenCalled()
    })

    it('refuses an upload that arrives after the time the caller stated', async () => {
      const stored = await makeUrl({
        expires_at: new Date(MADE.getTime() + 5 * MINUTE).toISOString(),
      })
      vi.setSystemTime(UPLOADED)
      await expect(useUrl(stored)).rejects.toMatchObject({
        status: 400,
        message: 'Expiration must be in the future.',
      })
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
    })

    it('follows the length of its profile at upload time for a token bound to one', async () => {
      profiles['profile-bound'] = profile({ expiration: 'WEEK' })
      const stored = await makeUrl({}, bound)
      expect(stored).toEqual({ options: {} })
      profiles['profile-bound'] = profile({ expiration: 'HOUR' })
      vi.setSystemTime(UPLOADED)
      await useUrl(stored, bound)
      expect(expiry()).toMatchObject({
        at: after(UPLOADED, 1).toISOString(),
        length: 'HOUR',
      })
    })
  })

  it('keeps everything the caller named: name, folder, tags and the password as a hash', async () => {
    const stored = await makeUrl({
      filename: 'q3 report.txt',
      visibility: 'private',
      password: 'correct horse battery',
    })
    expect(JSON.stringify(stored)).not.toContain('correct horse')
    expect(stored.options).not.toHaveProperty('password')
    await useUrl(stored)
    expect(created()).toMatchObject({
      name: 'q3 report.txt',
      visibility: 'PRIVATE',
      password: stored.passwordHash,
    })
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$10\$/)
  })

  it('refuses the upload, publishing nothing, when its profile was deleted in between', async () => {
    profiles['profile-default'] = profile({ visibility: 'PRIVATE' })
    account.defaultUploadProfileId = 'profile-default'
    const stored = await makeUrl()
    delete profiles['profile-default']
    account.defaultUploadProfileId = null
    await expect(useUrl(stored)).rejects.toMatchObject({
      message: 'Upload profile not found.',
    })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
    expect(mocks.uploadStream).not.toHaveBeenCalled()
  })

  describe('by a token bound to an upload profile', () => {
    it('stores only what was asked, none of what the profile says', async () => {
      profiles['profile-bound'] = profile({
        visibility: 'PRIVATE',
        expiration: 'DAY',
      })
      expect(await makeUrl({}, bound)).toEqual({ options: {} })
      expect(await makeUrl({ filename: 'shot.txt' }, bound)).toEqual({
        filename: 'shot.txt',
        options: {},
      })
    })

    it.each([
      ['private', 'public', 'PRIVATE', 'PUBLIC'],
      ['public', 'private', 'PUBLIC', 'PRIVATE'],
    ])(
      'follows its profile as it is when the upload happens: made %s, then %s',
      async (_before, _after, then, now) => {
        profiles['profile-bound'] = profile({ visibility: then })
        const stored = await makeUrl({}, bound)
        profiles['profile-bound'] = profile({ visibility: now })
        await useUrl(stored, bound)
        expect(created()).toMatchObject({
          visibility: now,
          uploadOptions: expect.objectContaining({
            visibility: now,
            profileId: 'profile-bound',
          }),
        })
      }
    )

    it('is refused once its profile is gone', async () => {
      profiles['profile-bound'] = profile({ visibility: 'PRIVATE' })
      const stored = await makeUrl({}, bound)
      delete profiles['profile-bound']
      await expect(useUrl(stored, bound)).rejects.toMatchObject({
        message: 'Upload profile not found.',
      })
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
    })
  })
})

/** A one-pixel PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
  'latin1'
)
/** Bytes no file type starts with. */
const UNKNOWN = Buffer.from([1, 2, 3, 4, 0xff, 0xfe, 0x10, 0x20, 0x30, 0x40])

/** A ZIP archive holding one stored file. */
function zipOf(name: string, content: string) {
  const data = Buffer.from(content)
  const file = Buffer.from(name)
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(file.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(file.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + file.length, 12)
  end.writeUInt32LE(30 + file.length + data.length, 16)
  return Buffer.concat([local, file, data, central, file, end])
}
const ZIP = zipOf('hello.txt', 'hello')
const UNNAMED = 'application/octet-stream'

describe('the type of an upload whose options its caller fixed', () => {
  // curl names a type for a few extensions and sends this one for the rest.
  it.each([
    ['a ZIP archive', 'backup.zip', ZIP, 'application/zip'],
    ['a PNG', 'photo.png', PNG, 'image/png'],
    ['a PDF', 'report.pdf', PDF, 'application/pdf'],
    // The bytes decide, not the name.
    ['a PNG under a text name', 'notes.txt', PNG, 'image/png'],
  ])(
    'is the type the bytes are when %s is sent without one',
    async (_what, name, body, detected) => {
      const answer = await directUpload(
        await request({ name, body, type: UNNAMED }),
        user,
        { options: {} }
      )
      expect(created()).toMatchObject({ name, mimeType: detected })
      expect(answer).toMatchObject({ id: 'file-1', name, type: detected })
      expect(mocks.deleteFile).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['bytes of no known type', UNKNOWN],
    ['plain text, which no bytes identify', Buffer.from('just some notes\n')],
    ['an empty file', Buffer.alloc(0)],
  ])('stays application/octet-stream for %s', async (_what, body) => {
    await directUpload(
      await request({ name: 'data.bin', body, type: UNNAMED }),
      user,
      { options: {} }
    )
    expect(created()).toMatchObject({ name: 'data.bin', mimeType: UNNAMED })
  })

  it.each([
    ['a ZIP archive claimed to be a PNG', ZIP, 'image/png', 'application/zip'],
    ['a PNG claimed to be a ZIP archive', PNG, 'application/zip', 'image/png'],
    ['a PNG claimed to be a PDF', PNG, 'application/pdf', 'image/png'],
    ['a PDF claimed to be text', PDF, 'text/plain', 'application/pdf'],
    // Close to "no type named", but a claim all the same.
    [
      'a PNG claimed to be binary/octet-stream',
      PNG,
      'binary/octet-stream',
      'image/png',
    ],
  ])(
    'still refuses %s, and removes the stored bytes',
    async (_what, body, claimed, detected) => {
      await expect(
        directUpload(await request({ body, type: claimed }), user, {
          options: {},
        })
      ).rejects.toMatchObject({
        status: 400,
        message: `File type mismatch: detected ${detected}, claimed ${claimed}`,
      })
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
      expect(mocks.deleteFile).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['a PNG named as one', PNG, 'image/png', 'image/png'],
    [
      'a ZIP archive under a vendor spelling',
      ZIP,
      'application/x-zip-compressed',
      'application/x-zip-compressed',
    ],
    ['text named as text', Buffer.from('notes'), 'text/plain', 'text/plain'],
  ])(
    'keeps the type the sender named for %s',
    async (_what, body, claimed, kept) => {
      await directUpload(await request({ body, type: claimed }), user, {
        options: {},
      })
      expect(created().mimeType).toBe(kept)
    }
  )

  it('checks the adopted type no differently for a paste or a renamed file', async () => {
    await directUpload(
      await request({ name: 'upload.bin', body: ZIP, type: UNNAMED }),
      user,
      { options: {}, filename: 'site backup.zip', isPaste: true }
    )
    expect(created()).toMatchObject({
      name: 'site backup.zip',
      mimeType: 'application/zip',
      isPaste: true,
    })
  })
})

describe('the type of an upload without fixed options', () => {
  it.each([
    ['a PNG', PNG, 'image/png'],
    ['a ZIP archive', ZIP, 'application/zip'],
    ['a PDF', PDF, 'application/pdf'],
  ])(
    'is still refused when %s is sent as application/octet-stream',
    async (_what, body, detected) => {
      await expect(
        directUpload(await request({ body, type: UNNAMED }), user)
      ).rejects.toMatchObject({
        status: 400,
        message: `File type mismatch: detected ${detected}, claimed ${UNNAMED}`,
      })
      expect(mocks.tx.file.create).not.toHaveBeenCalled()
      expect(mocks.deleteFile).toHaveBeenCalledOnce()
    }
  )

  it('still stores unrecognizable bytes sent as application/octet-stream as that', async () => {
    await directUpload(await request({ body: UNKNOWN, type: UNNAMED }), user)
    expect(created().mimeType).toBe(UNNAMED)
  })

  it('still stores a file under the type its sender named when the bytes agree', async () => {
    await directUpload(await request({ body: PNG, type: 'image/png' }), user)
    expect(created().mimeType).toBe('image/png')
  })
})

describe('an upload without fixed options', () => {
  it('still takes its profile and folder from headers and the rest from form fields', async () => {
    const answer = await directUpload(
      await request({
        fields: { visibility: 'PRIVATE', password: 'request-password' },
        headers: {
          'X-Upload-Profile': 'profile-header',
          'X-Upload-Folder': 'folder-header',
          'X-Flare-Paste': 'true',
        },
      }),
      user
    )
    expect(created()).toMatchObject({
      name: 'shot.txt',
      visibility: 'PRIVATE',
      folderId: 'folder-header',
      isPaste: true,
      uploadOptions: expect.objectContaining({ profileId: 'profile-header' }),
    })
    expect(created().password).toMatch(/^\$2[aby]\$10\$/)
    // The REST answer: links, and the file's ID, as fixed uploads give it.
    expect(Object.keys(answer).sort()).toEqual([
      'copyText',
      'downloadUrl',
      'id',
      'name',
      'pageUrl',
      'rawUrl',
      'size',
      'type',
      'url',
    ])
  })

  it('still refuses what the loud request asks for', async () => {
    await expect(directUpload(await request(LOUD), user)).rejects.toMatchObject(
      {
        status: 400,
        message: 'Conflicting upload profile selections.',
      }
    )
    await expect(
      directUpload(await request({ fields: LOUD.fields }), user)
    ).rejects.toMatchObject({
      status: 400,
      message: 'Tags must be a JSON array of tag IDs.',
    })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })
})
