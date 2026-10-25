import { GET } from '@/app/api/profile/export/route'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import yauzl from 'yauzl'

import { configureAuditWriter } from '@/lib/audit'
import { S3StorageProvider } from '@/lib/storage/providers/s3'
import { getProgress } from '@/lib/utils'

type ExportFile = {
  name: string
  path: string
  uploadedAt: Date
  mimeType: string
  size: number
  visibility: 'PUBLIC' | 'PRIVATE'
  isOcrProcessed: boolean
  ocrText: string | null
  isPaste: boolean
}

const state = vi.hoisted(() => ({
  files: [] as ExportFile[],
  provider: undefined as unknown,
  localStreams: [] as import('node:fs').ReadStream[],
}))

// Record local read streams, so a test can check they are closed.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: ((
      ...args: Parameters<typeof actual.createReadStream>
    ) => {
      const stream = actual.createReadStream(...args)
      state.localStreams.push(stream)
      return stream
    }) as typeof actual.createReadStream,
  }
})

vi.mock('@/lib/auth/api-auth', () => ({
  requireAuth: async () => ({ user: { id: 'export-owner' }, response: null }),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        id: 'export-owner',
        name: 'Export Owner',
        email: 'owner@example.test',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        files: state.files,
        shortenedUrls: [],
      }),
    },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.provider,
}))

function exportFile(
  name: string,
  path: string,
  uploadedAt = '2026-10-01T12:00:00Z'
): ExportFile {
  return {
    name,
    path,
    uploadedAt: new Date(uploadedAt),
    mimeType: 'application/octet-stream',
    size: 0.01,
    visibility: 'PRIVATE',
    isOcrProcessed: false,
    ocrText: null,
    isPaste: false,
  }
}

/** An S3-kind provider whose objects are in-memory buffers. */
function s3Provider(
  objects: Record<string, Buffer>,
  open?: (path: string) => Readable | undefined
) {
  const opened: string[] = []
  return {
    opened,
    provider: {
      kind: 's3',
      getFileStream: async (path: string) => {
        opened.push(path)
        const custom = open?.(path)
        if (custom) return custom
        const bytes = objects[path]
        if (!bytes) throw new Error(`NoSuchKey: ${path}`)
        // Several chunks, so the archive reads the source over multiple turns.
        const chunks: Buffer[] = []
        for (let offset = 0; offset < bytes.length; offset += 16 * 1024)
          chunks.push(bytes.subarray(offset, offset + 16 * 1024))
        return Readable.from(chunks.length ? chunks : [Buffer.alloc(0)])
      },
    },
  }
}

async function unzip(archive: Buffer) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(archive, { lazyEntries: true }, (error, file) =>
      error ? reject(error) : resolve(file)
    )
  )
  const entries = new Map<string, Buffer>()
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, async (error, stream) => {
        if (error) return reject(error)
        const chunks: Buffer[] = []
        try {
          for await (const chunk of stream) chunks.push(chunk as Buffer)
        } catch (readError) {
          return reject(readError)
        }
        if (entries.has(entry.fileName))
          return reject(new Error(`Duplicate entry ${entry.fileName}`))
        entries.set(entry.fileName, Buffer.concat(chunks))
        zip.readEntry()
      })
    })
    zip.on('end', resolve)
    zip.on('error', reject)
    zip.readEntry()
  })
  return entries
}

function exportRequest() {
  return GET(new Request('https://flare.test/api/profile/export'))
}

const originalCwd = process.cwd()
let root: string

beforeEach(async () => {
  // The route resolves temporary paths from the working directory, as a
  // deployment does from /app. `public/` exists there in a real install.
  root = await mkdtemp(join(tmpdir(), 'flare-export-'))
  await mkdir(join(root, 'public'))
  process.chdir(root)
  configureAuditWriter(async () => {})
  state.files = []
  state.localStreams = []
})

afterEach(async () => {
  process.chdir(originalCwd)
  await rm(root, { recursive: true, force: true })
})

describe('profile data export from S3 storage', () => {
  it('keeps a traversal filename inside the archive and writes nothing outside it', async () => {
    const payload = Buffer.from('<script>document.title="audit"</script>')
    const { provider } = s3Provider({ 'uploads/o/1/audit-proof.html': payload })
    state.provider = provider
    state.files = [
      exportFile(
        '../../../public/audit-proof.html',
        'uploads/o/1/audit-proof.html'
      ),
    ]

    const response = await exportRequest()
    expect(response.status).toBe(200)
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(existsSync(join(root, 'public', 'audit-proof.html'))).toBe(false)
    expect(await readdir(join(root, 'public'))).toEqual([])
    expect(entries.get('files/2026-10-01/audit-proof.html')).toEqual(payload)
  })

  it('exports the bytes of every stored object', async () => {
    const objects = {
      'uploads/o/1/first.bin': Buffer.alloc(70_000, 1),
      'uploads/o/2/second.bin': Buffer.from('second object'),
      'uploads/o/3/third.bin': Buffer.alloc(40_000, 3),
    }
    const { provider } = s3Provider(objects)
    state.provider = provider
    state.files = [
      exportFile('first.bin', 'uploads/o/1/first.bin'),
      exportFile('second.bin', 'uploads/o/2/second.bin'),
      exportFile('third.bin', 'uploads/o/3/third.bin'),
    ]

    const response = await exportRequest()
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(entries.get('files/2026-10-01/first.bin')).toEqual(
      objects['uploads/o/1/first.bin']
    )
    expect(entries.get('files/2026-10-01/second.bin')).toEqual(
      objects['uploads/o/2/second.bin']
    )
    expect(entries.get('files/2026-10-01/third.bin')).toEqual(
      objects['uploads/o/3/third.bin']
    )
    expect(JSON.parse(entries.get('user-data.json')!.toString())).toMatchObject(
      {
        id: 'export-owner',
        files: [
          { name: 'first.bin' },
          { name: 'second.bin' },
          { name: 'third.bin' },
        ],
      }
    )
    await delay(10)
    expect(getProgress('export-owner')).toBe(100)
  })

  it('gives files that share a name and day separate archive entries', async () => {
    const objects = {
      'uploads/o/1/report.pdf': Buffer.from('first report'),
      'uploads/o/2/report.pdf': Buffer.from('second report'),
      'uploads/o/3/Report.PDF': Buffer.from('third report'),
      'uploads/o/4/report.pdf': Buffer.from('next day'),
    }
    const { provider } = s3Provider(objects)
    state.provider = provider
    state.files = [
      exportFile('report.pdf', 'uploads/o/1/report.pdf'),
      exportFile('report.pdf', 'uploads/o/2/report.pdf'),
      exportFile('Report.PDF', 'uploads/o/3/Report.PDF'),
      exportFile(
        'report.pdf',
        'uploads/o/4/report.pdf',
        '2026-10-02T08:00:00Z'
      ),
    ]

    const response = await exportRequest()
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(
      Object.fromEntries(
        [...entries]
          .filter(([name]) => name.startsWith('files/'))
          .map(([name, bytes]) => [name, bytes.toString()])
      )
    ).toEqual({
      'files/2026-10-01/report.pdf': 'first report',
      'files/2026-10-01/report (2).pdf': 'second report',
      'files/2026-10-01/Report (3).PDF': 'third report',
      'files/2026-10-02/report.pdf': 'next day',
    })
  })

  it('skips an object that storage cannot open and exports the rest', async () => {
    const { provider } = s3Provider({
      'uploads/o/2/kept.txt': Buffer.from('kept'),
    })
    state.provider = provider
    state.files = [
      exportFile('missing.txt', 'uploads/o/1/missing.txt'),
      exportFile('kept.txt', 'uploads/o/2/kept.txt'),
    ]

    const response = await exportRequest()
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(entries.has('files/2026-10-01/missing.txt')).toBe(false)
    expect(entries.get('files/2026-10-01/kept.txt')?.toString()).toBe('kept')
  })

  it('fails the download instead of truncating a file when storage breaks mid-read', async () => {
    const { provider } = s3Provider({}, () =>
      Readable.from(
        (async function* () {
          yield Buffer.alloc(32 * 1024, 7)
          await delay(5)
          throw new Error('Connection reset by storage')
        })()
      )
    )
    state.provider = provider
    state.files = [exportFile('broken.bin', 'uploads/o/1/broken.bin')]

    const response = await exportRequest()
    await expect(response.arrayBuffer()).rejects.toThrow()
    await delay(20)
    expect(getProgress('export-owner')).toBe(0)
  })

  it('stops reading storage when the download is cancelled', async () => {
    let source: Readable | undefined
    const { provider, opened } = s3Provider({}, (path) => {
      if (path !== 'uploads/o/1/large.bin') return undefined
      // Endless, slow object: only a cancelled download ends it.
      source = new Readable({
        read() {
          setTimeout(() => this.push(randomBytes(64 * 1024)), 2)
        },
      })
      return source
    })
    state.provider = provider
    state.files = [
      exportFile('large.bin', 'uploads/o/1/large.bin'),
      exportFile('later.bin', 'uploads/o/2/later.bin'),
    ]

    const response = await exportRequest()
    const reader = response.body!.getReader()
    for (let received = 0; received < 256 * 1024;) {
      const { value } = await reader.read()
      received += value?.length ?? 0
    }
    await reader.cancel()
    await delay(50)

    expect(source?.destroyed).toBe(true)
    expect(opened).toEqual(['uploads/o/1/large.bin'])
    expect(getProgress('export-owner')).toBe(0)
  })

  it('stops when the client leaves before reading any of the response', async () => {
    let source: Readable | undefined
    const { provider, opened } = s3Provider({}, (path) => {
      if (path !== 'uploads/o/1/large.bin') return undefined
      source = new Readable({
        read() {
          setTimeout(() => this.push(randomBytes(64 * 1024)), 2)
        },
      })
      return source
    })
    state.provider = provider
    state.files = [
      exportFile('large.bin', 'uploads/o/1/large.bin'),
      exportFile('later.bin', 'uploads/o/2/later.bin'),
    ]

    // Leaving before the response starts, as a reload can, means nothing
    // ever reads or cancels the body. Only the request signal reports it.
    const client = new AbortController()
    const response = await GET(
      new Request('https://flare.test/api/profile/export', {
        signal: client.signal,
      })
    )
    expect(response.status).toBe(200)
    await delay(20)
    client.abort()
    await delay(50)

    expect(source?.destroyed).toBe(true)
    expect(opened).toEqual(['uploads/o/1/large.bin'])
    expect(getProgress('export-owner')).toBe(0)
  })

  it('reads one storage object at a time, at the pace of the download', async () => {
    const size = 8 * 1024 * 1024
    const pulled: Record<string, number> = {}
    const { provider, opened } = s3Provider({}, (path) => {
      pulled[path] = 0
      let sent = 0
      return new Readable({
        read() {
          if (sent >= size) return void this.push(null)
          const chunk = Buffer.alloc(Math.min(64 * 1024, size - sent))
          // Incompressible bytes, so compression cannot absorb the backlog.
          for (let index = 0; index < chunk.length; index += 4)
            chunk.writeUInt32LE((Math.random() * 0xffffffff) >>> 0, index)
          sent += chunk.length
          pulled[path] = sent
          this.push(chunk)
        },
      })
    })
    state.provider = provider
    state.files = [
      exportFile('one.bin', 'uploads/o/1/one.bin'),
      exportFile('two.bin', 'uploads/o/2/two.bin'),
      exportFile('three.bin', 'uploads/o/3/three.bin'),
    ]

    const response = await exportRequest()
    const reader = response.body!.getReader()
    await reader.read()
    // The client stops reading. Storage reads must stop too.
    await delay(300)
    expect(opened).toEqual(['uploads/o/1/one.bin'])
    expect(pulled['uploads/o/1/one.bin']).toBeLessThan(size)

    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
    }
    expect(total).toBeGreaterThan(3 * size)
    expect(opened).toEqual([
      'uploads/o/1/one.bin',
      'uploads/o/2/two.bin',
      'uploads/o/3/three.bin',
    ])
  }, 30_000)

  it('names entries from the last part of a legacy saved path', async () => {
    const { provider } = s3Provider({
      'uploads/o/1/shot.png': Buffer.from('windows path'),
      'uploads/o/2/notes.txt': Buffer.from('posix path'),
    })
    state.provider = provider
    state.files = [
      exportFile('C:\\Users\\me\\shot.png', 'uploads/o/1/shot.png'),
      exportFile('photos/2026/notes.txt', 'uploads/o/2/notes.txt'),
    ]

    const response = await exportRequest()
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(entries.get('files/2026-10-01/shot.png')?.toString()).toBe(
      'windows path'
    )
    expect(entries.get('files/2026-10-01/notes.txt')?.toString()).toBe(
      'posix path'
    )
  })
})

describe('profile data export from local storage', () => {
  beforeEach(() => {
    state.provider = { kind: 'local' }
  })

  it('exports local files and skips missing ones', async () => {
    await mkdir(join(root, 'uploads/o/1'), { recursive: true })
    await writeFile(join(root, 'uploads/o/1/kept.txt'), 'local bytes')
    state.files = [
      exportFile('gone.txt', 'uploads/o/2/gone.txt'),
      exportFile('kept.txt', 'uploads/o/1/kept.txt'),
    ]

    const response = await exportRequest()
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(entries.has('files/2026-10-01/gone.txt')).toBe(false)
    expect(entries.get('files/2026-10-01/kept.txt')?.toString()).toBe(
      'local bytes'
    )
    expect(state.localStreams.every((stream) => stream.closed)).toBe(true)
  })

  it('closes the open file when the download is cancelled', async () => {
    await mkdir(join(root, 'uploads/o/1'), { recursive: true })
    await writeFile(
      join(root, 'uploads/o/1/large.bin'),
      randomBytes(16 * 1024 * 1024)
    )
    state.files = [
      exportFile('large.bin', 'uploads/o/1/large.bin'),
      exportFile('later.bin', 'uploads/o/1/later.bin'),
    ]

    const response = await exportRequest()
    const reader = response.body!.getReader()
    for (let received = 0; received < 256 * 1024;) {
      const { value } = await reader.read()
      received += value?.length ?? 0
    }
    await reader.cancel()
    await delay(50)

    expect(state.localStreams).toHaveLength(1)
    expect(state.localStreams[0].closed).toBe(true)
    expect(getProgress('export-owner')).toBe(0)
  })
})

// A real S3 provider and AWS SDK client against a loopback object server.
describe('profile data export through the S3 provider', () => {
  const objects = new Map<string, Buffer>()
  const requested: string[] = []
  const closed: string[] = []
  const endless = 'o/1/endless.bin'
  const server = createServer((request, response) => {
    const key = decodeURIComponent(
      (request.url ?? '').split('?')[0].replace(/^\/export-bucket\//, '')
    )
    requested.push(key)
    if (key === endless) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      const timer = setInterval(() => response.write(randomBytes(64 * 1024)), 2)
      response.on('close', () => {
        clearInterval(timer)
        closed.push(key)
      })
      return
    }
    const body = objects.get(key)
    if (!body) return void response.writeHead(404).end()
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
    })
    response.end(body)
  })
  let endpoint = ''

  beforeAll(async () => {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('No fixture port')
    endpoint = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  beforeEach(() => {
    requested.length = 0
    closed.length = 0
    state.provider = new S3StorageProvider({
      bucket: 'export-bucket',
      region: 'us-east-1',
      accessKeyId: 'public-test-key',
      secretAccessKey: 'public-test-secret',
      endpoint,
      forcePathStyle: true,
    })
  })

  it('archives object bodies read through the SDK', async () => {
    objects.set('o/1/audit-proof.html', Buffer.from('<p>proof</p>'))
    objects.set('o/2/photo.jpg', randomBytes(300 * 1024))
    state.files = [
      exportFile(
        '../../../public/audit-proof.html',
        'uploads/o/1/audit-proof.html'
      ),
      exportFile('photo.jpg', 'uploads/o/2/photo.jpg'),
    ]

    const response = await exportRequest()
    const entries = await unzip(Buffer.from(await response.arrayBuffer()))

    expect(entries.get('files/2026-10-01/audit-proof.html')).toEqual(
      objects.get('o/1/audit-proof.html')
    )
    expect(entries.get('files/2026-10-01/photo.jpg')).toEqual(
      objects.get('o/2/photo.jpg')
    )
    expect(await readdir(join(root, 'public'))).toEqual([])
    expect(requested).toEqual(['o/1/audit-proof.html', 'o/2/photo.jpg'])
  })

  it('closes the S3 request when the download is cancelled', async () => {
    objects.set('o/2/later.bin', Buffer.from('later'))
    state.files = [
      exportFile('endless.bin', `uploads/${endless}`),
      exportFile('later.bin', 'uploads/o/2/later.bin'),
    ]

    const response = await exportRequest()
    const reader = response.body!.getReader()
    for (let received = 0; received < 256 * 1024;) {
      const { value } = await reader.read()
      received += value?.length ?? 0
    }
    await reader.cancel()
    for (let wait = 0; wait < 100 && !closed.length; wait++) await delay(10)

    expect(closed).toEqual([endless])
    expect(requested).toEqual([endless])
  })
})
