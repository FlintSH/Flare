import { GET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { hashSync } from 'bcryptjs'
import type { ReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { LocalStorageProvider } from '@/lib/storage/providers/local'

// Probe the native descriptor too; @types/node omits this runtime property.
type LocalReadStream = ReadStream & { fd: number | null }

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findUnique: vi.fn(),
  findOwner: vi.fn(),
  update: vi.fn(),
  size: vi.fn(),
  stream: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: mocks.findUnique, update: mocks.update },
    user: { findUnique: mocks.findOwner },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    getFileSize: mocks.size,
    getFileStream: mocks.stream,
  }),
}))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: vi.fn() } } }))

const content = Buffer.from('raw view fixture')
const password = 'disposable-file-password'
const passwordHash = hashSync(password, 4)
const file = {
  id: 'raw-view-file',
  name: 'fixture.txt',
  path: 'fixture.txt',
  urlPath: '/owner/fixture.txt',
  userId: 'owner',
  visibility: 'PUBLIC' as 'PUBLIC' | 'PRIVATE',
  password: null as string | null,
  mimeType: 'text/plain',
  views: 7,
}

function request(
  options: { range?: string; method?: string; password?: string } = {}
) {
  const query = new URLSearchParams()
  if (options.password) query.set('password', options.password)
  return GET(
    new Request(`https://flare.example${file.urlPath}/raw?${query}`, {
      method: options.method ?? 'GET',
      headers: options.range ? { range: options.range } : {},
    }),
    { params: Promise.resolve({ userUrlId: 'owner', filename: file.name }) }
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  file.visibility = 'PUBLIC'
  file.password = null
  file.views = 7
  mocks.session.mockResolvedValue(null)
  mocks.findUnique.mockResolvedValue(file)
  mocks.findOwner.mockResolvedValue(null)
  mocks.update.mockImplementation(async ({ data }) => {
    file.views += data.views.increment
    return file
  })
  mocks.size.mockResolvedValue(content.length)
  mocks.stream.mockImplementation(async (_path, range) =>
    Readable.from([
      range ? content.subarray(range.start, range.end + 1) : content,
    ])
  )
  configureAuditWriter(async () => {})
})

describe('raw file views', () => {
  it('counts each full-content GET while preserving the streamed response', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await request()
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(content.toString())
      expect(response.headers.get('content-length')).toBe(
        String(content.length)
      )
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('content-security-policy')).toBe('sandbox')
      expect(file.views).toBe(8 + i)
    }
    expect(mocks.update).toHaveBeenCalledTimes(2)
  })

  it.each(['bytes=0-2', 'bytes=4-'])(
    'counts a partial-content GET (%s)',
    async (range) => {
      const response = await request({ range })
      const start = Number(range.slice(6).split('-')[0])
      const end = range.endsWith('-') ? content.length - 1 : 2
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe(
        `bytes ${start}-${end}/${content.length}`
      )
      expect(await response.text()).toBe(
        content.subarray(start, end + 1).toString()
      )
      expect(file.views).toBe(8)
      expect(mocks.update).toHaveBeenCalledOnce()
    }
  )

  it.each([undefined, 'bytes=0-2'])(
    'does not count automatic HEAD handling (range: %s)',
    async (range) => {
      const response = await request({ method: 'HEAD', range })
      expect(response.status).toBe(range ? 206 : 200)
      await response.body?.cancel()
      expect(file.views).toBe(7)
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, 'incorrect-password'])(
    'does not count password-denied requests (%s)',
    async (providedPassword) => {
      file.password = passwordHash
      const response = await request({ password: providedPassword })
      expect(response.status).toBe(401)
      expect(file.views).toBe(7)
      expect(mocks.stream).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )

  it('counts protected content only after the password check succeeds', async () => {
    file.password = passwordHash
    const response = await request({ password })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(content.toString())
    expect(file.views).toBe(8)
  })

  it('does not count an anonymous request for a private file', async () => {
    file.visibility = 'PRIVATE'
    const response = await request()
    expect(response.status).toBe(404)
    expect(file.views).toBe(7)
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    { id: 'owner', permissions: ['files.read'] },
    { id: 'moderator', permissions: ['content.read'] },
  ])('counts authorized private-file reads by $id', async (user) => {
    file.visibility = 'PRIVATE'
    file.password = passwordHash
    mocks.session.mockResolvedValue({ user })
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(content.toString())
    expect(file.views).toBe(8)
  })

  it.each([null, { urlId: 'owner' }])(
    'does not count a missing file (vanity owner: %o)',
    async (owner) => {
      mocks.findUnique.mockResolvedValue(null)
      mocks.findOwner.mockResolvedValue(owner)
      const response = await request()
      expect(response.status).toBe(404)
      expect(file.views).toBe(7)
      expect(mocks.stream).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )

  // The AWS SDK names a missing key in `name`, never in the message.
  const s3Error = (name: string, message: string) =>
    Object.assign(new Error(message), { name })

  it.each([
    ['size', undefined, new Error('Storage unavailable'), 500],
    ['size', undefined, s3Error('NotFound', 'UnknownError'), 404],
    [
      'stream',
      undefined,
      s3Error('NoSuchKey', 'The specified key does not exist.'),
      404,
    ],
    [
      'stream',
      'bytes=0-2',
      s3Error('NoSuchKey', 'The specified key does not exist.'),
      404,
    ],
    ['stream', 'bytes=0-2', new Error('Storage unavailable'), 500],
  ] as const)(
    'does not count a %s failure (range: %s, error: %s)',
    async (operation, range, error, status) => {
      mocks[operation].mockRejectedValueOnce(error)
      const response = await request({ range })
      expect(response.status).toBe(status)
      expect(file.views).toBe(7)
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )
})

describe.each([undefined, 'bytes=0-2'])(
  'local raw stream lifecycle (range: %s)',
  (range) => {
    async function withLocalFile(
      check: (path: string, provider: LocalStorageProvider) => Promise<void>
    ) {
      await mkdir('uploads', { recursive: true })
      const directory = await mkdtemp('uploads/raw-views-test-')
      const path = join(directory, 'fixture.txt')
      await writeFile(path, content)
      try {
        await check(path, new LocalStorageProvider())
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }

    it('opens the real file before writing its view and streams the expected bytes', async () => {
      await withLocalFile(async (path, provider) => {
        let stream: LocalReadStream | undefined
        let closed: Promise<void> | undefined
        mocks.size.mockImplementation(() => provider.getFileSize(path))
        mocks.stream.mockImplementation(async (_path, options) => {
          stream = (await provider.getFileStream(
            path,
            options
          )) as LocalReadStream
          closed = new Promise((resolve) => stream!.once('close', resolve))
          return stream
        })
        mocks.update.mockImplementation(async ({ data }) => {
          expect(stream?.pending).toBe(false)
          expect(stream?.fd).toBeTypeOf('number')
          expect(stream?.readableFlowing).toBe(false)
          file.views += data.views.increment
          return file
        })
        try {
          const response = await request({ range })
          expect(response.status).toBe(range ? 206 : 200)
          expect(await response.text()).toBe(
            (range ? content.subarray(0, 3) : content).toString()
          )
          await closed
          expect(stream?.fd).toBeNull()
          expect(file.views).toBe(8)
        } finally {
          stream?.destroy()
          await closed
        }
      })
    })

    it('answers 404 for a file removed after the size check, without counting a view', async () => {
      await withLocalFile(async (path, provider) => {
        let stream: LocalReadStream | undefined
        let closed: Promise<void> | undefined
        mocks.size.mockImplementation(() => provider.getFileSize(path))
        mocks.stream.mockImplementation(async (_path, options) => {
          await unlink(path)
          stream = (await provider.getFileStream(
            path,
            options
          )) as LocalReadStream
          closed = new Promise((resolve) => stream!.once('close', resolve))
          return stream
        })
        mocks.update.mockImplementation(async ({ data }) => {
          await delay(25)
          file.views += data.views.increment
          return file
        })
        try {
          const response = await request({ range })
          expect(response.status).toBe(404)
          expect(mocks.update).not.toHaveBeenCalled()
          expect(file.views).toBe(7)
          expect(stream?.destroyed).toBe(true)
          await closed
          expect(stream?.fd).toBeNull()
        } finally {
          stream?.destroy()
          await closed
        }
      })
    })

    it('closes the real descriptor when the view-count write rejects', async () => {
      await withLocalFile(async (path, provider) => {
        let stream: LocalReadStream | undefined
        let closed: Promise<void> | undefined
        mocks.size.mockImplementation(() => provider.getFileSize(path))
        mocks.stream.mockImplementation(async (_path, options) => {
          stream = (await provider.getFileStream(
            path,
            options
          )) as LocalReadStream
          closed = new Promise((resolve) => stream!.once('close', resolve))
          return stream
        })
        mocks.update.mockImplementation(async () => {
          await delay(25)
          expect(stream?.fd).toBeTypeOf('number')
          throw new Error('View counter unavailable')
        })
        try {
          const response = await request({ range })
          expect(response.status).toBe(500)
          expect(mocks.update).toHaveBeenCalledOnce()
          expect(file.views).toBe(7)
          expect(stream?.destroyed).toBe(true)
          await closed
          expect(stream?.fd).toBeNull()
        } finally {
          stream?.destroy()
          await closed
        }
      })
    })

    it('closes the real descriptor if response header validation fails', async () => {
      await withLocalFile(async (path, provider) => {
        let stream: LocalReadStream | undefined
        let closed: Promise<void> | undefined
        mocks.size.mockImplementation(() => provider.getFileSize(path))
        mocks.stream.mockImplementation(async (_path, options) => {
          stream = (await provider.getFileStream(
            path,
            options
          )) as LocalReadStream
          closed = new Promise((resolve) => stream!.once('close', resolve))
          return stream
        })
        const mimeType = file.mimeType
        file.mimeType = 'text/plain\r\ninvalid-header'
        try {
          const response = await request({ range })
          expect(response.status).toBe(500)
          expect(mocks.update).not.toHaveBeenCalled()
          expect(file.views).toBe(7)
          expect(stream?.destroyed).toBe(true)
          await closed
          expect(stream?.fd).toBeNull()
        } finally {
          file.mimeType = mimeType
          stream?.destroy()
          await closed
        }
      })
    })
  }
)
