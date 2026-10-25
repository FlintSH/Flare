import { NextRequest } from 'next/server'

import { GET as rawGET } from '@/app/(raw)/[userUrlId]/[filename]/raw/route'
import { GET as pathGET } from '@/app/api/files/[...path]/route'
import { GET as downloadGET } from '@/app/api/files/[id]/download/route'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import type { StorageProvider } from '@/lib/storage'
import { LocalStorageProvider } from '@/lib/storage/providers/local'

const state = vi.hoisted(() => ({
  provider: undefined as unknown as Pick<
    StorageProvider,
    'getFileSize' | 'getFileStream' | 'getDownloadUrl'
  >,
  views: 0,
  downloads: 0,
}))

const content = Buffer.from('0123456789abcdefghij')
const fixture = {
  id: 'range-file',
  name: 'range.txt',
  path: '',
  urlPath: '/owner/range.txt',
  userId: 'owner',
  visibility: 'PUBLIC' as const,
  password: null,
  mimeType: 'text/plain',
  size: content.length / 1024 ** 2,
}

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/files/resolve', () => ({
  resolveFileUrlPath: async () => fixture.urlPath,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: {
      findUnique: async () => fixture,
      update: async ({
        data,
      }: {
        data: { views?: { increment: number }; downloads?: object }
      }) => {
        if (data.views) state.views++
        if (data.downloads) state.downloads++
        return fixture
      },
    },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.provider,
}))

// S3 answers a Range request with the bytes it can satisfy, clamping the end.
function s3Like(bytes: Buffer) {
  return {
    getFileSize: async () => bytes.length,
    getDownloadUrl: async () => null,
    getFileStream: async (
      _path: string,
      range?: { start?: number; end?: number }
    ) =>
      Readable.from([
        range
          ? bytes.subarray(
              range.start || 0,
              (range.end ?? bytes.length - 1) + 1
            )
          : bytes,
      ]),
  }
}

const routes = {
  raw: (headers: HeadersInit) =>
    rawGET(
      new Request(`https://flare.test${fixture.urlPath}/raw`, { headers }),
      {
        params: Promise.resolve({ userUrlId: 'owner', filename: 'range.txt' }),
      }
    ),
  path: (headers: HeadersInit) =>
    pathGET(
      new NextRequest(`https://flare.test/api/files${fixture.urlPath}`, {
        headers,
      }),
      {
        params: Promise.resolve({ path: ['owner', 'range.txt'] }),
      }
    ),
  download: (headers: HeadersInit) =>
    downloadGET(
      new NextRequest(`https://flare.test/api/files/${fixture.id}/download`, {
        headers,
      }),
      { params: Promise.resolve({ id: fixture.id }) }
    ),
}

let directory = ''
beforeAll(async () => {
  await mkdir('uploads', { recursive: true })
  directory = await mkdtemp('uploads/byte-ranges-test-')
  fixture.path = join(directory, 'range.txt')
  await writeFile(fixture.path, content)
  await writeFile(join(directory, 'empty.txt'), '')
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})
beforeEach(() => {
  configureAuditWriter(async () => {})
  state.views = 0
  state.downloads = 0
})

async function expectBody(response: Response, expected: Buffer) {
  const body = Buffer.from(await response.arrayBuffer())
  expect(body.equals(expected)).toBe(true)
  expect(response.headers.get('content-length')).toBe(String(expected.length))
}

describe.each([
  ['local storage', () => new LocalStorageProvider()],
  ['S3 storage', () => s3Like(content)],
])('byte ranges with %s', (_label, provider) => {
  beforeEach(() => {
    state.provider = provider()
  })

  describe.each(Object.entries(routes))('%s route', (route, get) => {
    it('serves a first-last range exactly', async () => {
      const response = await get({ range: 'bytes=2-5' })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 2-5/20')
      await expectBody(response, content.subarray(2, 6))
    })

    it('serves a suffix range from the end of the file', async () => {
      const response = await get({ range: 'bytes=-5' })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 15-19/20')
      await expectBody(response, content.subarray(15))
    })

    it('clamps an end past the file instead of advertising missing bytes', async () => {
      const response = await get({ range: 'bytes=3-999999999' })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 3-19/20')
      await expectBody(response, content.subarray(3))
    })

    it.each(['bytes=abc-', 'bytes=5-2', 'bytes=0-1,4-5'])(
      'ignores an unusable or multi-range header (%s)',
      async (range) => {
        const response = await get({ range })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-range')).toBeNull()
        await expectBody(response, content)
      }
    )

    it('answers a range that starts past the end with 416', async () => {
      const response = await get({ range: 'bytes=20-' })
      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */20')
      expect((await response.arrayBuffer()).byteLength).toBe(0)
      if (route !== 'download') {
        expect(response.headers.get('content-security-policy')).toBe('sandbox')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      }
      if (route === 'raw') expect(state.views).toBe(0)
    })
  })
})

describe('empty files', () => {
  beforeEach(() => {
    state.provider = s3Like(Buffer.alloc(0))
  })

  it.each(Object.entries(routes))(
    '%s route answers any range on an empty file with 416',
    async (_route, get) => {
      const response = await get({ range: 'bytes=0-' })
      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */0')
    }
  )
})
