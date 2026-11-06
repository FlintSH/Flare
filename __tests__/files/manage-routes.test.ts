import {
  DELETE as deleteOwn,
  PATCH as updateOwn,
} from '@/app/api/files/[id]/route'
import {
  DELETE as deleteModerated,
  PATCH as updateModerated,
} from '@/app/api/users/[id]/files/[fileId]/route'
import { GET as listModerated } from '@/app/api/users/[id]/files/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditInput, configureAuditWriter } from '@/lib/audit'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => {
  const tx = { file: { delete: vi.fn() }, user: { update: vi.fn() } }
  return {
    tx,
    session: vi.fn(),
    file: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  }
})
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: mocks.file,
    $transaction: async (run: (client: typeof mocks.tx) => unknown) =>
      run(mocks.tx),
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ deleteFile: async () => {} }),
}))

const files = mocks.file
const found = {
  id: 'file-one',
  name: 'meeting-notes.txt',
  userId: 'owner',
  path: 'owner/meeting-notes.txt',
  size: 12,
}
const stored = {
  id: 'file-one',
  name: 'meeting-notes.txt',
  urlPath: '/aB3x9/meeting-notes.txt',
  mimeType: 'text/plain',
  size: 12,
  visibility: 'PRIVATE',
  uploadedAt: new Date('2026-09-20T12:00:00.000Z'),
  userId: 'owner',
  path: 'owner/meeting-notes.txt',
  password: '$2b$10$stored-hash',
}
const answered = JSON.stringify({
  ...(({ password: _hash, ...metadata }) => metadata)(stored),
  hasPassword: true,
})
const events: Partial<AuditInput>[] = []

const request = (
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  new Request(`https://flare.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const own = { params: Promise.resolve({ id: 'file-one' }) }
/** Signs in `id` holding exactly these permissions. */
const signIn = (id: string, ...permissions: string[]) =>
  mocks.session.mockResolvedValue({ user: { id, permissions } })
const moderated = {
  params: Promise.resolve({ id: 'owner', fileId: 'file-one' }),
}

beforeEach(() => {
  vi.resetAllMocks()
  events.length = 0
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
  signIn('owner', 'files.share', 'files.delete')
  files.findUnique.mockResolvedValue(found)
  files.update.mockResolvedValue(stored)
})

describe("the owner's file routes", () => {
  const patch = (body: unknown) =>
    updateOwn(request('/api/files/file-one', 'PATCH', body), own)

  it('answers the stored file without its hash', async () => {
    signIn('owner', 'files.share')
    const response = await patch({ visibility: 'PRIVATE', ignored: true })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(answered)
  })

  it('checks the session and its permission before the body', async () => {
    // Had the route looked the file up first, each answer would be this 404.
    files.findUnique.mockResolvedValue(null)
    mocks.session.mockResolvedValue(null)
    const signedOut = await patch({ visibility: 'HIDDEN' })
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).toEqual({ error: 'Authentication required' })
    signIn('owner', 'files.delete')
    const refused = await patch({ visibility: 'HIDDEN' })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'Permission denied' })
    signIn('owner', 'files.share')
    const invalid = await patch({ visibility: 'HIDDEN' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'Invalid request body' })
  })

  it.each([
    ['a missing file', null, 404, 'File not found'],
    [
      "another account's file",
      { ...found, userId: 'other' },
      401,
      'Unauthorized',
    ],
  ])('refuses %s', async (_case, file, status, error) => {
    files.findUnique.mockResolvedValue(file)
    for (const response of [
      await patch({ visibility: 'PUBLIC' }),
      await deleteOwn(request('/api/files/file-one', 'DELETE'), own),
    ]) {
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error })
    }
    expect(files.update).not.toHaveBeenCalled()
    expect(mocks.tx.file.delete).not.toHaveBeenCalled()
  })

  it('deletes with a success body and keeps its own failure message', async () => {
    const deleted = await deleteOwn(
      request('/api/files/file-one', 'DELETE'),
      own
    )
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ success: true })

    vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    mocks.tx.file.delete.mockRejectedValue(new Error('database unavailable'))
    const failed = await deleteOwn(
      request('/api/files/file-one', 'DELETE'),
      own
    )
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'Failed to delete file' })

    files.update.mockRejectedValue(new Error('database unavailable'))
    const notUpdated = await patch({ visibility: 'PUBLIC' })
    expect(notUpdated.status).toBe(500)
    expect(await notUpdated.json()).toEqual({ error: 'Failed to update file' })
  })
})

describe('the moderation file routes', () => {
  const patch = (body: unknown, headers?: Record<string, string>) =>
    updateModerated(
      request('/api/users/owner/files/file-one', 'PATCH', body, headers),
      moderated
    )
  const remove = () =>
    deleteModerated(
      request('/api/users/owner/files/file-one', 'DELETE'),
      moderated
    )

  beforeEach(() => {
    signIn('moderator', 'content.update', 'content.delete')
  })

  it('answers a missing or foreign file with 404 instead of failing', async () => {
    // The file belongs to another account than the one in the route, and a
    // lookup that names an account finds only that account's file.
    const foreign = { ...found, userId: 'other' }
    files.findUnique.mockImplementation(
      async ({ where }: { where: { userId?: string } }) =>
        (where.userId ?? foreign.userId) === foreign.userId ? foreign : null
    )
    const response = await patch({ visibility: 'PUBLIC' })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'File not found' })
    expect(files.update).not.toHaveBeenCalled()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'http.patch',
        outcome: 'failure',
        status: 404,
      }),
    ])

    const deleted = await remove()
    expect(deleted.status).toBe(404)
    expect(await deleted.json()).toEqual({ error: 'File not found' })
  })

  it("changes the account's file and answers it without its hash", async () => {
    signIn('moderator', 'content.update')
    const response = await patch({ visibility: 'PRIVATE' })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(answered)
    expect(files.update).toHaveBeenCalledWith({
      where: { id: 'file-one', userId: 'owner' },
      data: { visibility: 'PRIVATE' },
    })
  })

  it('refuses unknown fields and foreign origins', async () => {
    const extra = await patch({ visibility: 'PRIVATE', ignored: true })
    expect(extra.status).toBe(400)
    expect(await extra.json()).toEqual({ error: 'Invalid file settings' })

    const foreign = await patch(
      { visibility: 'PRIVATE' },
      { Origin: 'https://foreign.test' }
    )
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({
      error: 'Cross-origin requests are not allowed.',
    })
    expect(files.update).not.toHaveBeenCalled()
  })

  it('deletes with an empty 204', async () => {
    signIn('moderator', 'content.delete')
    const response = await remove()
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.tx.file.delete).toHaveBeenCalledWith({
      where: { id: 'file-one', userId: 'owner' },
    })
  })

  it('keeps its unexpected-failure body', async () => {
    vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    files.update.mockRejectedValue(new Error('database unavailable'))
    const response = await patch({ visibility: 'PUBLIC' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal Server Error' })
  })
})

describe('the moderation file list', () => {
  const list = (query: string) =>
    listModerated(
      new Request(`https://flare.test/api/users/member/files${query}`),
      { params: Promise.resolve({ id: 'member' }) }
    )

  beforeEach(() => {
    signIn('moderator', 'content.read')
  })

  it('keeps the list shape, the PROTECTED value and the default page size', async () => {
    const row = {
      id: 'file-one',
      name: 'meeting-notes.txt',
      mimeType: 'text/plain',
      size: 12,
      visibility: 'PRIVATE',
      uploadedAt: stored.uploadedAt,
      urlPath: '/aB3x9/meeting-notes.txt',
      isPaste: false,
    }
    files.count.mockResolvedValue(1)
    files.findMany.mockResolvedValue([{ ...row, password: 'hash' }])
    const response = await list('?search=notes&visibility=PRIVATE&type=text/')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      JSON.stringify({
        files: [{ ...row, visibility: 'PROTECTED' }],
        pagination: { total: 1, pages: 1, page: 1, limit: 10 },
      })
    )
    expect(files.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'member',
        visibility: 'PRIVATE',
        mimeType: { startsWith: 'text/' },
      }),
    })
  })

  it.each([
    ['?page=abc&limit=xyz', 25, { skip: 0, take: 10 }, { page: 1, limit: 10 }],
    ['?page=0&limit=-5', 25, { skip: 0, take: 10 }, { page: 1, limit: 10 }],
    [
      '?page=2&limit=1000',
      250,
      { skip: 100, take: 100 },
      { page: 2, limit: 100 },
    ],
    ['?page=40&limit=10', 25, { skip: 20, take: 10 }, { page: 3, limit: 10 }],
  ])(
    'answers %s with a page that exists, within the limits',
    async (query, total, window, pagination) => {
      files.count.mockResolvedValue(total)
      files.findMany.mockResolvedValue([])
      const response = await list(query)
      expect(response.status).toBe(200)
      expect((await response.json()).pagination).toMatchObject(pagination)
      expect(files.findMany).toHaveBeenCalledWith(
        expect.objectContaining(window)
      )
    }
  )

  it('answers an unknown visibility with 400 instead of failing', async () => {
    const response = await list('?visibility=PROTECTED')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'visibility must be public or private',
    })
    expect(files.count).not.toHaveBeenCalled()
  })

  it('keeps its unexpected-failure body and logs the cause', async () => {
    const logged = vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    files.count.mockRejectedValue(new Error('database unavailable'))
    const response = await list('')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal Server Error' })
    expect(logged).toHaveBeenCalledWith(
      'GET /api/users/[id]/files failed',
      expect.any(Error)
    )
  })
})
