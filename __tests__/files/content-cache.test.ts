import { GET as rawGET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { GET as contentGET } from '@/app/api/files/[...path]/route'
import {
  GET as downloadGET,
  POST as downloadPOST,
} from '@/app/api/files/[id]/download/route'
import { hashSync } from 'bcryptjs'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  resolve: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  size: vi.fn(),
  stream: vi.fn(),
  downloadUrl: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: mocks.findUnique, update: mocks.update } },
}))
vi.mock('@/lib/files/resolve', () => ({ resolveFileUrlPath: mocks.resolve }))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileSize: mocks.size,
    getFileStream: mocks.stream,
    getDownloadUrl: mocks.downloadUrl,
  }),
}))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: vi.fn() } } }))

const content = Buffer.from('cache header fixture bytes')
const password = 'disposable-file-password'
const passwordHash = hashSync(password, 4)
const owner = { user: { id: 'owner', permissions: ['files.read'] } }
const moderator = { user: { id: 'moderator', permissions: ['content.read'] } }

type Visibility = 'PUBLIC' | 'PRIVATE'
const file = {
  id: 'cache-file',
  name: 'clip.mp4',
  path: 'uploads/owner/key/clip.mp4',
  urlPath: '/owner/clip.mp4',
  userId: 'owner',
  visibility: 'PUBLIC' as Visibility,
  password: null as string | null,
  mimeType: 'video/mp4',
  size: 1,
  views: 0,
  downloads: 0,
}

function contentRequest(options: { range?: string; password?: string } = {}) {
  const query = options.password
    ? `?${new URLSearchParams({ password: options.password })}`
    : ''
  return contentGET(
    new Request(`https://flare.test/api/files${file.urlPath}${query}`, {
      headers: options.range ? { range: options.range } : {},
    }) as never,
    { params: Promise.resolve({ path: file.urlPath.slice(1).split('/') }) }
  )
}

function rawRequest(options: { range?: string; password?: string } = {}) {
  const query = options.password
    ? `?${new URLSearchParams({ password: options.password })}`
    : ''
  return rawGET(
    new Request(`https://flare.test${file.urlPath}/raw${query}`, {
      headers: options.range ? { range: options.range } : {},
    }),
    { params: Promise.resolve({ userUrlId: 'owner', filename: 'clip.mp4' }) }
  )
}

function downloadRequest(
  options: { range?: string; password?: string; method?: 'GET' | 'POST' } = {}
) {
  if (options.method === 'POST')
    return downloadPOST(
      new Request(`https://flare.test/api/files/${file.id}/download`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          options.password ? { password: options.password } : {}
        ),
      }),
      { params: Promise.resolve({ id: file.id }) }
    )
  const query = options.password
    ? `?${new URLSearchParams({ password: options.password })}`
    : ''
  return downloadGET(
    new Request(`https://flare.test/api/files/${file.id}/download${query}`, {
      headers: options.range ? { range: options.range } : {},
    }) as never,
    { params: Promise.resolve({ id: file.id }) }
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(file, {
    visibility: 'PUBLIC',
    password: null,
    mimeType: 'video/mp4',
  })
  mocks.session.mockResolvedValue(null)
  mocks.resolve.mockResolvedValue(file.urlPath)
  mocks.findUnique.mockImplementation(async () => ({ ...file }))
  mocks.update.mockResolvedValue(file)
  mocks.size.mockResolvedValue(content.length)
  mocks.stream.mockImplementation(async (_path, range) =>
    Readable.from([
      range ? content.subarray(range.start, range.end + 1) : content,
    ])
  )
  mocks.downloadUrl.mockResolvedValue(null)
  configureAuditWriter(async () => {})
})

async function cacheControl(response: Response | Promise<Response>) {
  const resolved = await response
  await resolved.body?.cancel()
  return {
    status: resolved.status,
    cache: resolved.headers.get('cache-control'),
  }
}

describe('file content cache headers', () => {
  describe('/api/files/{path}', () => {
    it.each([undefined, 'bytes=0-3'])(
      'keeps a password-protected video out of shared caches for its owner (range: %s)',
      async (range) => {
        file.password = passwordHash
        mocks.session.mockResolvedValue(owner)
        expect(await cacheControl(contentRequest({ range }))).toEqual({
          status: range ? 206 : 200,
          cache: 'private, no-store',
        })
      }
    )

    it.each([undefined, 'bytes=0-3'])(
      'keeps a private video out of shared caches for its owner and moderators (range: %s)',
      async (range) => {
        file.visibility = 'PRIVATE'
        for (const session of [owner, moderator]) {
          mocks.session.mockResolvedValue(session)
          expect(await cacheControl(contentRequest({ range }))).toEqual({
            status: range ? 206 : 200,
            cache: 'private, no-store',
          })
        }
      }
    )

    it.each([undefined, 'bytes=0-3'])(
      'keeps a video unlocked with its password out of shared caches (range: %s)',
      async (range) => {
        file.password = passwordHash
        expect(await cacheControl(contentRequest({ range, password }))).toEqual(
          { status: range ? 206 : 200, cache: 'private, no-store' }
        )
      }
    )

    it.each([undefined, 'bytes=0-3'])(
      'keeps protected non-video content out of shared caches (range: %s)',
      async (range) => {
        file.mimeType = 'text/plain'
        file.visibility = 'PRIVATE'
        mocks.session.mockResolvedValue(owner)
        expect(await cacheControl(contentRequest({ range }))).toEqual({
          status: range ? 206 : 200,
          cache: 'private, no-store',
        })
      }
    )

    it.each([undefined, 'bytes=0-3'])(
      'still lets caches keep a public, unprotected video for a year (range: %s)',
      async (range) => {
        expect(await cacheControl(contentRequest({ range }))).toEqual({
          status: range ? 206 : 200,
          cache: 'public, max-age=31536000',
        })
      }
    )

    it('still revalidates other public, unprotected content', async () => {
      file.mimeType = 'text/plain'
      expect(await cacheControl(contentRequest())).toEqual({
        status: 200,
        cache: 'no-cache',
      })
    })

    it.each([
      ['PRIVATE', null, 404],
      ['PUBLIC', 'password', 401],
    ] as const)(
      'does not let a cache store a denial for a %s file',
      async (visibility, protectedBy, status) => {
        file.visibility = visibility
        file.password = protectedBy ? passwordHash : null
        expect(await cacheControl(contentRequest())).toEqual({
          status,
          cache: 'private, no-store',
        })
      }
    )
  })

  describe('/{userUrlId}/{filename}/raw', () => {
    it.each([undefined, 'bytes=0-3'])(
      'marks protected content private, no-store (range: %s)',
      async (range) => {
        file.password = passwordHash
        mocks.session.mockResolvedValue(owner)
        expect(await cacheControl(rawRequest({ range }))).toEqual({
          status: range ? 206 : 200,
          cache: 'private, no-store',
        })
        mocks.session.mockResolvedValue(null)
        expect(await cacheControl(rawRequest({ range, password }))).toEqual({
          status: range ? 206 : 200,
          cache: 'private, no-store',
        })
        file.password = null
        file.visibility = 'PRIVATE'
        mocks.session.mockResolvedValue(owner)
        expect(await cacheControl(rawRequest({ range }))).toEqual({
          status: range ? 206 : 200,
          cache: 'private, no-store',
        })
      }
    )

    it('leaves public, unprotected content without a cache directive', async () => {
      expect(await cacheControl(rawRequest())).toEqual({
        status: 200,
        cache: null,
      })
    })

    it('does not let a cache store a denial', async () => {
      file.visibility = 'PRIVATE'
      expect(await cacheControl(rawRequest())).toEqual({
        status: 404,
        cache: 'private, no-store',
      })
    })
  })

  describe('/api/files/{id}/download', () => {
    it.each([
      ['GET', undefined],
      ['GET', 'bytes=0-3'],
      ['POST', undefined],
    ] as const)(
      'marks protected downloads private, no-store (%s, range: %s)',
      async (method, range) => {
        file.password = passwordHash
        expect(
          await cacheControl(downloadRequest({ method, range, password }))
        ).toEqual({
          status: range ? 206 : 200,
          cache: 'private, no-store',
        })
      }
    )

    it.each(['GET', 'POST'] as const)(
      'keeps a protected signed-URL redirect out of caches (%s)',
      async (method) => {
        file.visibility = 'PRIVATE'
        mocks.session.mockResolvedValue(owner)
        mocks.downloadUrl.mockResolvedValue(
          'https://bucket.test/clip.mp4?X-Amz-Signature=disposable'
        )
        const response = await downloadRequest({ method })
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
          'https://bucket.test/clip.mp4?X-Amz-Signature=disposable'
        )
        expect(response.headers.get('cache-control')).toBe('private, no-store')
      }
    )

    it('leaves public, unprotected downloads without a cache directive', async () => {
      expect(await cacheControl(downloadRequest())).toEqual({
        status: 200,
        cache: null,
      })
    })
  })
})
