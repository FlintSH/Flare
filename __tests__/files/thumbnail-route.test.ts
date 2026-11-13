import { GET } from '@/app/api/files/[id]/thumbnail/route'
import { hashSync } from 'bcryptjs'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { auditSettled, configureAuditWriter } from '@/lib/audit'
import { loggers } from '@/lib/logger'

type FixtureFile = {
  id: string
  name: string
  mimeType: string
  path: string
  size: number
  visibility: 'PUBLIC' | 'PRIVATE'
  userId: string
  password: string | null
}

const state = vi.hoisted(() => ({
  file: null as FixtureFile | null,
  bytes: Buffer.alloc(0) as Buffer,
  session: null as {
    user: { id: string; permissions: string[] }
  } | null,
  findFile: vi.fn(),
  getFileStream: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => state.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: state.findFile } },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getFileStream: state.getFileStream }),
}))

const PUBLIC_CACHE = 'public, max-age=31536000, immutable'
const password = 'disposable-file-password'
const owner = { user: { id: 'owner', permissions: ['files.read'] } }
const photo: FixtureFile = {
  id: 'photo',
  name: 'photo.png',
  mimeType: 'image/png',
  path: 'uploads/owner/photo/photo.png',
  // In megabytes, as files record it.
  size: 0.01,
  visibility: 'PUBLIC',
  userId: 'owner',
  password: null,
}
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><script>alert(document.domain)</script></svg>'
)
let png: Buffer
let address = 0

/** Each request comes from its own address, so no password limit is reached. */
function thumbnail(query = '') {
  return GET(
    new Request(`https://flare.test/api/files/photo/thumbnail${query}`, {
      headers: { 'x-real-ip': `198.51.100.${++address % 250}` },
    }),
    { params: Promise.resolve({ id: 'photo' }) }
  )
}
const body = async (response: Response) =>
  Buffer.from(await response.arrayBuffer())

beforeAll(async () => {
  png = await sharp({
    create: { width: 1200, height: 300, channels: 3, background: '#3366cc' },
  })
    .png()
    .toBuffer()
})

beforeEach(() => {
  vi.clearAllMocks()
  configureAuditWriter(async () => undefined)
  // The resized copies the module keeps for the whole process.
  const kept = (
    globalThis as unknown as Record<
      symbol,
      { cached: Map<string, unknown>; bytes: number }
    >
  )[Symbol.for('flare.files.thumbnails')]
  kept.cached.clear()
  kept.bytes = 0
  state.file = { ...photo }
  state.bytes = png
  state.session = null
  state.findFile.mockImplementation(async () => state.file)
  state.getFileStream.mockImplementation(async () =>
    Readable.from([state.bytes])
  )
})
afterEach(auditSettled)

describe('a thumbnail of the width the browser asks for', () => {
  it('answers a public image with a WebP copy any cache may keep, sandboxed', async () => {
    const response = await thumbnail('?w=384')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const copy = await body(response)
    expect(response.headers.get('content-length')).toBe(String(copy.length))
    expect(await sharp(copy).metadata()).toMatchObject({
      format: 'webp',
      width: 384,
      height: 96,
    })
    // The file's recorded size decides whether it is read at all.
    expect(state.findFile).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'photo' },
      select: expect.objectContaining({ size: true, path: true }),
    })
  })

  it.each([
    ['300', 384],
    ['1', 256],
    ['5000', 1200],
  ])(
    'answers w=%s with the next width up, never wider than the image',
    async (w, width) => {
      const response = await thumbnail(`?w=${w}`)
      expect(response.headers.get('content-type')).toBe('image/webp')
      expect((await sharp(await body(response)).metadata()).width).toBe(width)
    }
  )

  it('keeps the copy of a private image out of every cache', async () => {
    state.file = { ...photo, visibility: 'PRIVATE' }
    state.session = owner
    const response = await thumbnail('?w=384')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('keeps the copy of a password-protected image out of every cache', async () => {
    state.file = { ...photo, password: hashSync(password, 4) }
    const query = new URLSearchParams({ w: '384', password })
    const visitor = await thumbnail(`?${query}`)
    expect(visitor.status).toBe(200)
    expect(visitor.headers.get('content-type')).toBe('image/webp')
    expect(visitor.headers.get('cache-control')).toBe('private, no-store')

    state.session = owner
    const own = await thumbnail('?w=384')
    expect(own.status).toBe(200)
    expect(own.headers.get('content-type')).toBe('image/webp')
    expect(own.headers.get('cache-control')).toBe('private, no-store')
  })

  it('checks access before answering, also for a copy it already made', async () => {
    expect((await thumbnail('?w=384')).status).toBe(200)
    expect(state.getFileStream).toHaveBeenCalledOnce()

    // The owner makes the file private, then protects it with a password.
    state.file = { ...photo, visibility: 'PRIVATE' }
    const hidden = await thumbnail('?w=384')
    expect(hidden.status).toBe(404)
    expect(hidden.headers.get('content-type')).not.toBe('image/webp')
    expect(await hidden.text()).toBe('')

    state.file = { ...photo, password: hashSync(password, 4) }
    const locked = await thumbnail('?w=384')
    expect(locked.status).toBe(401)
    expect(locked.headers.get('cache-control')).toBe('private, no-store')
    expect(await locked.text()).toBe('')
    const wrong = await thumbnail('?w=384&password=wrong')
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toBe('')

    // Whoever may read it gets the copy without another read of storage.
    state.session = owner
    const own = await thumbnail('?w=384')
    expect(own.headers.get('content-type')).toBe('image/webp')
    expect(own.headers.get('cache-control')).toBe('private, no-store')
    expect(state.getFileStream).toHaveBeenCalledOnce()
  })

  it('answers a missing file with 404, with or without a width', async () => {
    state.file = null
    for (const query of ['', '?w=384']) {
      const response = await thumbnail(query)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('File not found')
    }
    expect(state.getFileStream).not.toHaveBeenCalled()
  })

  it.each(['abc', '0', '-1', '1.5', '', '1000000', '384px'])(
    'answers w=%j with 400 and says what a width is',
    async (w) => {
      const response = await thumbnail(`?w=${encodeURIComponent(w)}`)
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('w must be a positive whole number')
      expect(response.headers.get('content-type')).toMatch(/^text\/plain/)
      expect(state.getFileStream).not.toHaveBeenCalled()
    }
  )

  it('answers an invalid width the same for a file the requester cannot read', async () => {
    state.file = { ...photo, visibility: 'PRIVATE' }
    const hidden = await thumbnail('?w=abc')
    state.file = null
    const missing = await thumbnail('?w=abc')
    expect([hidden.status, missing.status]).toEqual([400, 400])
    expect(await hidden.text()).toBe(await missing.text())
  })
})

describe('a preview the browser stopped waiting for', () => {
  it('answers nothing, without reading the image or sending the original', async () => {
    const response = await GET(
      new Request('https://flare.test/api/files/photo/thumbnail?w=384', {
        headers: { 'x-real-ip': `198.51.100.${++address % 250}` },
        signal: AbortSignal.abort(),
      }),
      { params: Promise.resolve({ id: 'photo' }) }
    )
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(state.getFileStream).not.toHaveBeenCalled()
  })

  it('still answers a copy it already made', async () => {
    await thumbnail('?w=384')
    const response = await GET(
      new Request('https://flare.test/api/files/photo/thumbnail?w=384', {
        headers: { 'x-real-ip': `198.51.100.${++address % 250}` },
        signal: AbortSignal.abort(),
      }),
      { params: Promise.resolve({ id: 'photo' }) }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
  })
})

describe('the original image as a thumbnail', () => {
  it('answers the stored bytes and type when no width is asked for', async () => {
    const response = await thumbnail()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await body(response)).toEqual(png)
  })

  it('answers an SVG as it is, sandboxed, whatever width is asked for', async () => {
    state.file = { ...photo, name: 'drawing.svg', mimeType: 'image/svg+xml' }
    state.bytes = svg
    for (const query of ['?w=384', '?w=384', '']) {
      const response = await thumbnail(query)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/svg+xml')
      expect(response.headers.get('content-security-policy')).toBe('sandbox')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE)
      expect(await body(response)).toEqual(svg)
    }
  })

  it('answers SVG bytes stored under another image type as they are, never as a picture of them', async () => {
    // The stored type is the uploader's claim.
    state.bytes = svg
    const response = await thumbnail('?w=384')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(await body(response)).toEqual(svg)
  })

  it('answers an image too large to resize as it is', async () => {
    state.file = { ...photo, size: 33 }
    const response = await thumbnail('?w=384')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(await body(response)).toEqual(png)
    // Only the original was read; nothing was resized.
    expect(state.getFileStream).toHaveBeenCalledOnce()
  })

  it('keeps a private original out of every cache, resized or not', async () => {
    state.file = { ...photo, visibility: 'PRIVATE', mimeType: 'image/svg+xml' }
    state.bytes = svg
    state.session = owner
    for (const query of ['', '?w=384']) {
      const response = await thumbnail(query)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('content-security-policy')).toBe('sandbox')
    }
  })

  it('answers a stored object that is gone with 404', async () => {
    const logged = vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    state.getFileStream.mockRejectedValue(
      Object.assign(new Error('No such object'), { code: 'ENOENT' })
    )
    for (const query of ['', '?w=384']) {
      const response = await thumbnail(query)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).not.toBe('image/webp')
    }
    expect(logged).toHaveBeenCalledTimes(2)
    logged.mockRestore()
  })
})

describe('files that are not images', () => {
  const document = {
    ...photo,
    name: 'report.pdf',
    mimeType: 'application/pdf',
  }

  it.each(['', '?w=384'])(
    'answers 400 for one the requester may read (%j)',
    async (query) => {
      state.file = { ...document }
      const response = await thumbnail(query)
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Not an image')
      expect(state.getFileStream).not.toHaveBeenCalled()
    }
  )

  it.each(['', '?w=384'])(
    'hides one the requester may not read, as it hides any other file (%j)',
    async (query) => {
      state.file = { ...document, visibility: 'PRIVATE' }
      const hidden = await thumbnail(query)
      expect(hidden.status).toBe(404)
      expect(await hidden.text()).toBe('')

      state.file = { ...document, password: hashSync(password, 4) }
      expect((await thumbnail(query)).status).toBe(401)

      // Its owner is told it is not an image.
      state.session = owner
      const own = await thumbnail(query)
      expect(own.status).toBe(400)
      expect(await own.text()).toBe('Not an image')
      expect(state.getFileStream).not.toHaveBeenCalled()
    }
  )
})
