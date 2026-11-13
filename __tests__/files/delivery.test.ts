import { GET as directGET } from '@/app/(raw)/[userUrlId]/[filename]/direct/route'
import { GET as rawGET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { GET as contentGET } from '@/app/api/files/[...path]/route'
import {
  GET as downloadGET,
  POST as downloadPOST,
} from '@/app/api/files/[id]/download/route'
import { GET as ocrGET } from '@/app/api/files/[id]/ocr/route'
import { GET as thumbnailGET } from '@/app/api/files/[id]/thumbnail/route'
import { hashSync } from 'bcryptjs'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { auditSettled, configureAuditWriter } from '@/lib/audit'
import { LocalStorageProvider } from '@/lib/storage/providers/local'

type Row = {
  id: string
  name: string
  urlPath: string
  path: string
  mimeType: string
  userId: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  isOcrProcessed: boolean
  ocrText: string | null
  ocrConfidence: number | null
  ocrTagsPendingAt: Date | null
}

const state = vi.hoisted(() => ({
  files: [] as Row[],
  owners: new Map<string, { urlId: string }>(),
  provider: undefined as unknown,
  audits: [] as Array<Record<string, unknown>>,
}))

const db = vi.hoisted(() => ({
  findFile: vi.fn(),
  findOwner: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: db.findFile, update: db.update },
    user: { findUnique: db.findOwner },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.provider,
}))
vi.mock('@/lib/logger', () => {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  return { loggers: new Proxy({}, { get: () => logger }) }
})

const bytes = Buffer.from('0123456789')
const password = 'delivery-test-password'
const passwordHash = hashSync(password, 4)

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'file-1',
    name: 'notes.txt',
    urlPath: '/abc12/my-notes.txt',
    path: 'uploads/abc12/key/notes.txt',
    mimeType: 'text/plain',
    userId: 'owner',
    visibility: 'PUBLIC',
    password: null,
    isOcrProcessed: true,
    ocrText: 'saved text',
    ocrConfidence: 90,
    ocrTagsPendingAt: null,
    ...overrides,
  }
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
    getDownloadUrl: vi.fn(async () => null),
    getPublicUrl: vi.fn(async () => null),
  }
}

const byId = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (path: string, init?: RequestInit) =>
  new Request(`https://flare.test${path}`, init)

beforeEach(() => {
  vi.clearAllMocks()
  state.files = [row()]
  state.owners = new Map([['flint', { urlId: 'abc12' }]])
  state.provider = memoryStorage()
  state.audits = []
  configureAuditWriter(async (event) => void state.audits.push(event))
  db.findFile.mockImplementation(
    async ({ where }: { where: { id?: string; urlPath?: string } }) =>
      state.files.find((file) =>
        where.id ? file.id === where.id : file.urlPath === where.urlPath
      ) ?? null
  )
  db.findOwner.mockImplementation(
    async ({ where }: { where: { vanityId: string } }) =>
      state.owners.get(where.vanityId) ?? null
  )
  db.update.mockResolvedValue(undefined)
})
// A file that was served is recorded after its response; keep that event out
// of the next test's list.
afterEach(auditSettled)

describe('finding the requested file', () => {
  it('reads a share link once, then serves it without querying it again', async () => {
    const response = await rawGET(get('/abc12/my-notes.txt/raw'), {
      params: Promise.resolve({ userUrlId: 'abc12', filename: 'my-notes.txt' }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(bytes.toString())
    expect(db.findFile).toHaveBeenCalledOnce()
    expect(db.findOwner).not.toHaveBeenCalled()
  })

  it('finds a share link under the vanity ID with spaces typed for dashes', async () => {
    const response = await rawGET(get('/flint/my%20notes.txt/raw'), {
      params: Promise.resolve({ userUrlId: 'flint', filename: 'my notes.txt' }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(bytes.toString())
  })

  it('keeps vanity IDs out of /api/files/{urlPath}, which takes stored paths', async () => {
    const vanity = await contentGET(get('/api/files/flint/my-notes.txt'), {
      params: Promise.resolve({ path: ['flint', 'my-notes.txt'] }),
    })
    expect(vanity.status).toBe(404)

    const typed = await contentGET(get('/api/files/abc12/my%20notes.txt'), {
      params: Promise.resolve({ path: ['abc12', 'my notes.txt'] }),
    })
    expect(typed.status).toBe(200)
  })
})

describe('refusals', () => {
  it('records a masked denial as denied and never lets a cache keep it', async () => {
    state.files = [row({ visibility: 'PRIVATE' })]
    const response = await downloadGET(
      get('/api/files/file-1/download'),
      byId('file-1')
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('')
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: 'file.download',
        outcome: 'denied',
        targetId: 'file-1',
      }),
    ])
    expect(db.update).not.toHaveBeenCalled()
  })

  it('keeps the /direct lookup refusal without a cache directive', async () => {
    state.files = [row({ password: passwordHash, mimeType: 'video/mp4' })]
    const response = await directGET(get('/abc12/my-notes.txt/direct'), {
      params: Promise.resolve({ userUrlId: 'abc12', filename: 'my-notes.txt' }),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBeNull()
  })
})

describe('image routes check access before the file type', () => {
  it.each([
    ['private', { visibility: 'PRIVATE' as const }, 404, 'Unauthorized'],
    [
      'password-protected',
      { password: passwordHash },
      401,
      'Password required',
    ],
  ])(
    'hide a %s file that is not an image like any other',
    async (_label, overrides, status, error) => {
      state.files = [row(overrides)]
      const thumbnail = await thumbnailGET(
        get('/api/files/file-1/thumbnail'),
        byId('file-1')
      )
      expect(thumbnail.status).toBe(status)
      expect(thumbnail.headers.get('cache-control')).toBe('private, no-store')
      expect(await thumbnail.text()).toBe('')

      const ocr = await ocrGET(get('/api/files/file-1/ocr'), byId('file-1'))
      expect(ocr.status).toBe(status)
      expect(await ocr.json()).toEqual({ success: false, error })
    }
  )

  it('still names the type problem to someone who may read the file', async () => {
    const thumbnail = await thumbnailGET(
      get('/api/files/file-1/thumbnail'),
      byId('file-1')
    )
    expect(thumbnail.status).toBe(400)
    expect(await thumbnail.text()).toBe('Not an image')

    const ocr = await ocrGET(get('/api/files/file-1/ocr'), byId('file-1'))
    expect(ocr.status).toBe(400)
    expect(await ocr.json()).toEqual({
      success: false,
      error: 'File is not an image',
    })
  })

  it('keeps their answers for an unknown file', async () => {
    state.files = []
    const thumbnail = await thumbnailGET(
      get('/api/files/missing/thumbnail'),
      byId('missing')
    )
    expect(thumbnail.status).toBe(404)
    expect(await thumbnail.text()).toBe('File not found')

    const ocr = await ocrGET(get('/api/files/missing/ocr'), byId('missing'))
    expect(ocr.status).toBe(404)
    expect(await ocr.json()).toEqual({
      success: false,
      error: 'File not found',
    })
  })
})

describe('a stored object that is gone', () => {
  const image = () =>
    row({ mimeType: 'image/png', path: 'uploads/delivery-test/gone.png' })

  const routes = {
    raw: () =>
      rawGET(get('/abc12/my-notes.txt/raw'), {
        params: Promise.resolve({
          userUrlId: 'abc12',
          filename: 'my-notes.txt',
        }),
      }),
    content: () =>
      contentGET(get('/api/files/abc12/my-notes.txt'), {
        params: Promise.resolve({ path: ['abc12', 'my-notes.txt'] }),
      }),
    download: () =>
      downloadGET(get('/api/files/file-1/download'), byId('file-1')),
    thumbnail: () =>
      thumbnailGET(get('/api/files/file-1/thumbnail'), byId('file-1')),
  }

  it.each(Object.entries(routes))(
    '%s answers 404 for a local file that no longer exists',
    async (_route, request) => {
      state.files = [image()]
      state.provider = new LocalStorageProvider()
      const response = await request()
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
    }
  )

  const s3Error = (name: string, message: string) =>
    Object.assign(new Error(message), { name })

  it.each(Object.entries(routes))(
    '%s answers 404 when S3 has no such key',
    async (_route, request) => {
      state.files = [image()]
      const storage = memoryStorage()
      storage.getFileSize.mockRejectedValue(s3Error('NotFound', 'UnknownError'))
      storage.getFileStream.mockRejectedValue(
        s3Error('NoSuchKey', 'The specified key does not exist.')
      )
      state.provider = storage
      expect((await request()).status).toBe(404)
      expect(db.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { views: { increment: 1 } } })
      )
    }
  )

  it.each([
    ['raw', 500],
    ['content', 404],
    ['download', 500],
    ['thumbnail', 500],
  ] as const)(
    '%s keeps its answer for other storage failures (%i)',
    async (route, status) => {
      state.files = [image()]
      const storage = memoryStorage()
      storage.getFileSize.mockRejectedValue(new Error('Storage unavailable'))
      storage.getFileStream.mockRejectedValue(new Error('Storage unavailable'))
      state.provider = storage
      expect((await routes[route]()).status).toBe(status)
    }
  )
})

describe('downloads', () => {
  it('read a POST password from the JSON body and ignore Range on POST', async () => {
    state.files = [row({ password: passwordHash })]
    const response = await downloadPOST(
      get('/api/files/file-1/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json', range: 'bytes=0-2' },
        body: JSON.stringify({ password }),
      }),
      byId('file-1')
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-range')).toBeNull()
    expect(await response.text()).toBe(bytes.toString())
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      data: { downloads: { increment: 1 } },
    })
  })

  it('name the file for every browser', async () => {
    state.files = [row({ name: 'Q3 "final" (2).txt' })]
    const response = await downloadGET(
      get('/api/files/file-1/download'),
      byId('file-1')
    )
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Q3%20%22final%22%20(2).txt"; filename*=UTF-8''Q3%20%22final%22%20%282%29.txt`
    )
  })

  it('send a stored name without `..`, as they always have', async () => {
    state.files = [row({ name: 'notes..txt' })]
    const response = await downloadGET(
      get('/api/files/file-1/download'),
      byId('file-1')
    )
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="notestxt"; filename*=UTF-8''notestxt`
    )
  })
})
