import { PUT } from '@/app/api/users/route'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { S3StorageProvider } from '@/lib/storage/providers/s3'

import { createInMemoryS3 } from '../storage/helpers/in-memory-s3'

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  lockEmailUser: vi.fn(),
  getEmailConfigForUpdate: vi.fn(),
  getStorageProvider: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    $executeRaw: vi.fn(),
    user: { update: vi.fn() },
    file: { findMany: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api-auth', () => ({
  requirePermission: mocks.requirePermission,
}))
vi.mock('@/lib/permissions/server', () => ({
  PermissionError: class PermissionError extends Error {},
  lockRoleChanges: vi.fn(),
  requireActorPermission: vi.fn(),
  assertCanManageUser: vi.fn(),
  validateRoleAssignment: vi.fn(),
  assertAccessibleAdministrator: vi.fn(),
  getUserAccess: async () => ({ roles: [], permissions: [] }),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/email/config', () => ({
  getEmailConfigForUpdate: mocks.getEmailConfigForUpdate,
}))
vi.mock('@/lib/email/account', () => ({
  lockEmailUser: mocks.lockEmailUser,
  lockEmailAddress: vi.fn(),
  sendAccountToken: vi.fn(),
}))
vi.mock('@/lib/email/tokens', () => ({ invalidateEmailTokens: vi.fn() }))
vi.mock('@/lib/users/create-user', () => ({ createUser: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: mocks.getStorageProvider,
}))
vi.mock('@/lib/logger', () => ({
  loggers: {
    users: { error: vi.fn() },
    storage: {
      getChildLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
    },
  },
}))

const initialUser = {
  id: 'owner',
  name: 'File owner',
  email: 'owner@example.com',
  urlId: 'abc12',
  vanityId: null,
  password: null,
  sessionVersion: 1,
}
const initialFiles = [
  {
    id: 'legacy',
    userId: initialUser.id,
    path: 'uploads/abc12/legacy.txt',
    urlPath: '/abc12/legacy.txt',
  },
  {
    id: 'uuid',
    userId: initialUser.id,
    path: 'uploads/abc12/1e980372-153a-4231-94e1-d528835aef71/new.txt',
    urlPath: '/abc12/new.txt',
  },
  {
    id: 'other',
    userId: 'someone-else',
    path: 'uploads/other/other.txt',
    urlPath: '/other/other.txt',
  },
]
let state: { user: typeof initialUser; files: typeof initialFiles }
const s3 = createInMemoryS3()
const storage = new S3StorageProvider({
  bucket: 'url-id-test',
  region: 'us-east-1',
  accessKeyId: 'test',
  secretAccessKey: 'test',
})

function request(urlId: string) {
  return new Request('https://flare.example/api/users', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: initialUser.id,
      name: initialUser.name,
      email: initialUser.email,
      urlId,
    }),
  })
}

async function expectOriginalObjects() {
  expect([...s3.store.keys()].sort()).toEqual(
    initialFiles.map((file) => file.path.replace(/^uploads\//, '')).sort()
  )
  for (const file of state.files) {
    const stream = await storage.getFileStream(file.path)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe(`contents of ${file.id}`)
  }
  expect(mocks.getStorageProvider).not.toHaveBeenCalled()
}

beforeEach(async () => {
  vi.resetAllMocks()
  s3.clear()
  state = structuredClone({ user: initialUser, files: initialFiles })
  mocks.requirePermission.mockResolvedValue({
    response: null,
    user: { id: 'operator', permissions: ['administrator'] },
  })
  mocks.getEmailConfigForUpdate.mockResolvedValue(DEFAULT_EMAIL_CONFIG)
  mocks.getStorageProvider.mockResolvedValue(storage)
  mocks.db.user.findUnique.mockImplementation(async ({ where }) =>
    where.id === state.user.id || where.urlId === state.user.urlId
      ? { ...state.user }
      : null
  )

  // File and user mutations must use the same transaction client.
  mocks.db.$transaction.mockImplementation(async (callback) => {
    const draft = structuredClone(state)
    mocks.lockEmailUser.mockResolvedValue(draft.user)
    mocks.tx.file.findMany.mockImplementation(async ({ where }) =>
      draft.files.filter((file) => file.userId === where.userId)
    )
    mocks.tx.file.update.mockImplementation(async ({ where, data }) => {
      const file = draft.files.find((file) => file.id === where.id)!
      Object.assign(file, data)
      return file
    })
    mocks.tx.user.update.mockImplementation(async ({ data }) => {
      Object.assign(draft.user, data)
      return draft.user
    })
    const result = await callback(mocks.tx)
    state = draft
    return result
  })
  for (const file of initialFiles) {
    await storage.uploadFile(
      Buffer.from(`contents of ${file.id}`),
      file.path,
      'text/plain'
    )
  }
})

afterAll(() => s3.restore())

describe('administrator URL ID updates', () => {
  it('changes public URLs together with the user and preserves legacy and UUID S3 objects', async () => {
    const response = await PUT(request('SPECC'))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { urlId: 'SPECC' } })
    expect(state.user.urlId).toBe('SPECC')
    expect(state.files).toEqual(
      initialFiles.map((file) => ({
        ...file,
        urlPath: file.urlPath.replace('/abc12/', '/SPECC/'),
      }))
    )
    expect(mocks.db.$transaction).toHaveBeenCalledOnce()
    expect(mocks.lockEmailUser).toHaveBeenCalledWith(mocks.tx, initialUser.id)
    expect(mocks.tx.file.update).toHaveBeenCalledTimes(2)
    expect(mocks.tx.user.update).toHaveBeenCalledOnce()
    await expectOriginalObjects()
  })

  it('supports repeated URL ID changes without moving existing objects', async () => {
    for (const urlId of ['SPECC', 'third', 'abc12']) {
      expect((await PUT(request(urlId))).status).toBe(200)
      expect(state.user.urlId).toBe(urlId)
      expect(state.files[0].urlPath).toBe(`/${urlId}/legacy.txt`)
      expect(state.files[1].urlPath).toBe(`/${urlId}/new.txt`)
      await expectOriginalObjects()
    }
  })

  it('allows a user with no uploaded files to change their URL ID', async () => {
    state.files = []

    expect((await PUT(request('SPECC'))).status).toBe(200)
    expect(state.user.urlId).toBe('SPECC')
    expect(mocks.tx.file.update).not.toHaveBeenCalled()
    expect(mocks.getStorageProvider).not.toHaveBeenCalled()
  })

  it('rejects an already assigned URL ID before changing files', async () => {
    mocks.db.user.findUnique
      .mockResolvedValueOnce(initialUser)
      .mockResolvedValueOnce({
        ...initialUser,
        id: 'someone-else',
        urlId: 'SPECC',
      })

    const response = await PUT(request('SPECC'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'URL ID is already in use',
    })
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
    expect(state).toEqual({ user: initialUser, files: initialFiles })
    await expectOriginalObjects()
  })

  it('preserves a concurrent URL ID edit when the submitted URL ID was unchanged', async () => {
    state.user.urlId = 'newer'
    state.files = state.files.map((file) => ({
      ...file,
      urlPath: file.urlPath.replace('/abc12/', '/newer/'),
    }))
    mocks.db.user.findUnique.mockResolvedValueOnce(initialUser)

    expect((await PUT(request(initialUser.urlId))).status).toBe(200)
    expect(state.user.urlId).toBe('newer')
    expect(state.files[0].urlPath).toBe('/newer/legacy.txt')
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'urlId'
    )
    expect(mocks.tx.file.update).not.toHaveBeenCalled()
    await expectOriginalObjects()
  })

  it('rejects a requested URL ID change when another edit won the user lock', async () => {
    state.user.urlId = 'newer'
    mocks.db.user.findUnique.mockResolvedValueOnce(initialUser)

    const response = await PUT(request('SPECC'))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'Account changed during update. Refresh the user and try again.',
    })
    expect(state.user.urlId).toBe('newer')
    expect(mocks.tx.file.update).not.toHaveBeenCalled()
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
    await expectOriginalObjects()
  })
})
