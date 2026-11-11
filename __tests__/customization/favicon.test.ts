import { GET as serve } from '@/app/api/favicon/route'
import {
  DELETE as remove,
  POST as save,
} from '@/app/api/settings/favicon/route'
import { generateMetadata } from '@/app/layout'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FAVICON_MAX_BYTES,
  faviconProblem,
  faviconUrl,
} from '@/lib/customization/favicon'
import { LocalStorageProvider } from '@/lib/storage/providers/local'

const state = vi.hoisted(() => ({
  favicon: null as string | null,
  provider: null as unknown,
  queued: [] as { ownerId: string; path: string; provider?: string }[],
}))
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'inter' }) }))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'manager', permissions: ['appearance.manage'] },
  }),
}))
// Transactions run one at a time, as the settings lock each one takes makes
// them in PostgreSQL.
const transactions = vi.hoisted(() => ({
  tail: Promise.resolve() as unknown,
  open: 0,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: (run: (tx: object) => unknown) => {
      const result = Promise.resolve(transactions.tail)
        .catch(() => {})
        .then(async () => {
          transactions.open++
          try {
            return await run({})
          } finally {
            transactions.open--
          }
        })
      transactions.tail = result.catch(() => {})
      return result
    },
  },
}))
vi.mock('@/lib/database/locks', () => ({ lockSettings: async () => {} }))
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  auditRequest: (
    _request: Request,
    _options: unknown,
    handle: () => Promise<Response>
  ) => handle(),
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: { appearance: { favicon: state.favicon } },
  }),
  getConfigOrDefaults: async () => ({
    settings: { appearance: { favicon: state.favicon } },
  }),
  readConfig: async () => ({
    settings: { appearance: { favicon: state.favicon } },
  }),
  applyConfigUpdate: async (
    _tx: unknown,
    update: { settings: { appearance: { favicon: string | null } } }
  ) => {
    state.favicon = update.settings.appearance.favicon
  },
}))
vi.mock('@/lib/storage/deletion', () => ({
  queueStorageDeletion: async (
    _tx: unknown,
    ownerId: string,
    path: string,
    target: { provider: string } | null
  ) => {
    state.queued.push({ ownerId, path, provider: target?.provider })
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => state.provider,
}))

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=',
  'base64'
)
const otherPng = Buffer.concat([png, Buffer.from('replacement')])
const version = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16)

describe('favicon rules shared by the settings control and the server', () => {
  it('words each refusal as the settings control always has', () => {
    expect(
      faviconProblem({ size: FAVICON_MAX_BYTES + 1, type: 'image/png' })
    ).toEqual({
      status: 413,
      title: 'File too large',
      message: 'Please upload a file smaller than 1 MB.',
    })
    expect(faviconProblem({ size: 10, type: 'image/jpeg' })).toEqual({
      status: 415,
      title: 'Invalid file type',
      message: 'Please upload a PNG image file.',
    })
    expect(
      faviconProblem({ size: FAVICON_MAX_BYTES + 1, type: 'image/jpeg' })
        ?.status
    ).toBe(413)
    expect(
      faviconProblem({ size: FAVICON_MAX_BYTES, type: 'image/png' })
    ).toBeNull()
  })

  it('links only to versioned addresses on this route', () => {
    const current = '/api/favicon?v=0123456789abcdef'
    expect(faviconUrl(null)).toBeNull()
    expect(faviconUrl('')).toBeNull()
    expect(faviconUrl(current)).toBe(current)
    for (const saved of [
      '/api/favicon',
      'https://bucket.s3.amazonaws.com/favicon.png?X-Amz-Signature=abc',
      'https://attacker.test/api/favicon?v=0123456789abcdef',
      `${current}&other=1`,
      '/api/favicon?v=0123456789ABCDEF',
    ])
      expect(faviconUrl(saved)).toBe('/api/favicon?v=0')
  })
})

describe('favicon upload, serving and page links', () => {
  const originalCwd = process.cwd()
  let directory: string
  let provider: LocalStorageProvider

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'flare-favicon-'))
    process.chdir(directory)
    provider = new LocalStorageProvider()
    state.provider = provider
    state.favicon = null
    state.queued = []
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    process.chdir(originalCwd)
    await rm(directory, { recursive: true, force: true })
  })

  function upload(bytes: Buffer, type = 'image/png', headers?: HeadersInit) {
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'icon.png')
    return save(
      new Request('http://localhost/api/settings/favicon', {
        method: 'POST',
        headers,
        body: form,
      })
    )
  }

  const fetchIcon = (address: string) =>
    serve(new Request(`http://localhost${address}`))

  const LEGACY = 'uploads/favicon.png'
  const keyOf = (url: string) => `${url.slice(url.indexOf('v=') + 2)}.png`
  const stored = (url: string) =>
    readFile(join(directory, 'uploads/favicons', keyOf(url)))
  // What the storage cleanup worker does with the queued jobs.
  const runCleanup = async () => {
    for (const { path } of state.queued.splice(0))
      await provider.deleteFile(path).catch(() => {})
  }
  // Every favicon object left in storage, the shared one of earlier versions too.
  const storedObjects = async () => [
    ...(await readdir(join(directory, 'uploads/favicons')).catch(() => [])),
    ...(await readFile(join(directory, LEGACY)).then(
      () => [LEGACY],
      () => []
    )),
  ]

  it('gives a replaced favicon a new address and caches only matching bytes for a year', async () => {
    const first = await upload(png, 'image/png', { Origin: 'http://localhost' })
    expect(first.status).toBe(200)
    const { url: firstUrl } = await first.json()
    expect(state.favicon).toBe(firstUrl)

    const second = await upload(otherPng)
    const { url: secondUrl } = await second.json()
    expect(secondUrl).not.toBe(firstUrl)
    expect(state.favicon).toBe(secondUrl)
    expect(await stored(secondUrl)).toEqual(otherPng)
    // Each upload has its own object; the replaced one is queued for deletion.
    expect(state.queued).toEqual([
      {
        ownerId: 'instance',
        path: `uploads/favicons/${keyOf(firstUrl)}`,
        provider: 'local',
      },
    ])
    await runCleanup()
    expect(await storedObjects()).toEqual([keyOf(secondUrl)])

    const current = await fetchIcon(secondUrl)
    expect(current.status).toBe(200)
    expect(current.headers.get('content-type')).toBe('image/png')
    expect(current.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(Buffer.from(await current.arrayBuffer())).toEqual(otherPng)

    // An old page's address gets today's icon, but never for keeps.
    for (const address of [firstUrl, '/api/favicon']) {
      const stale = await fetchIcon(address)
      expect(stale.status).toBe(200)
      expect(stale.headers.get('cache-control')).toBe('no-cache')
      expect(Buffer.from(await stale.arrayBuffer())).toEqual(otherPng)
    }
  })

  it('serves a favicon saved by an earlier version without caching it for long', async () => {
    await provider.uploadFile(png, 'uploads/favicon.png', 'image/png')
    state.favicon = '/api/favicon'
    const address = faviconUrl(state.favicon)!
    expect(address).toBe('/api/favicon?v=0')
    const response = await fetchIcon(address)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  it('answers 404 when no favicon is saved or its bytes are gone', async () => {
    state.favicon = '/api/favicon?v=0123456789abcdef'
    const missing = await fetchIcon(state.favicon)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('')

    // Bytes left in storage are not served once no favicon is saved.
    await provider.uploadFile(png, 'uploads/favicon.png', 'image/png')
    state.favicon = null
    const none = await fetchIcon('/api/favicon')
    expect(none.status).toBe(404)
  })

  it('sends the bytes itself even when storage could give the object an address', async () => {
    const { url } = await (await upload(png)).json()
    const publicUrl = vi
      .spyOn(provider, 'getPublicUrl')
      .mockResolvedValue(
        'https://bucket.example.test/favicon.png?X-Amz-Signature=abc'
      )
    const response = await fetchIcon(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
    expect(publicUrl).not.toHaveBeenCalled()
  })

  it('keeps serving and caching a favicon saved in the shared object by an earlier version, until it is replaced', async () => {
    await provider.uploadFile(png, LEGACY, 'image/png')
    state.favicon = `/api/favicon?v=${version(png)}`
    const response = await fetchIcon(state.favicon)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)

    const { url } = await (await upload(otherPng)).json()
    expect(state.queued.map(({ path }) => path)).toEqual([LEGACY])
    await runCleanup()
    expect(await storedObjects()).toEqual([keyOf(url)])
    expect(Buffer.from(await (await fetchIcon(url)).arrayBuffer())).toEqual(
      otherPng
    )
  })

  it("removes the favicon, so pages link Flare's icon again", async () => {
    const { url } = await (await upload(png)).json()
    const removal = (headers?: HeadersInit) =>
      remove(
        new Request('http://localhost/api/settings/favicon', {
          method: 'DELETE',
          headers,
        })
      )

    expect((await removal({ Origin: 'https://attacker.test' })).status).toBe(
      403
    )
    expect(state.favicon).toBe(url)

    const response = await removal({ Origin: 'http://localhost' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: null })
    expect(state.favicon).toBeNull()
    expect(state.queued.map(({ path }) => path)).toContain(
      `uploads/favicons/${keyOf(url)}`
    )
    await runCleanup()
    expect(await storedObjects()).toEqual([])
    expect((await fetchIcon(url)).status).toBe(404)
    expect((await generateMetadata()).icons).toEqual({
      icon: { url: '/icon.svg', type: 'image/svg+xml' },
    })

    // Removing again, with nothing stored, still succeeds and queues nothing.
    expect((await removal()).status).toBe(200)
    expect(state.queued).toEqual([])
  })

  it('refuses other origins, non-form bodies and uploads breaking the control rules before storing anything', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    const oversized = Buffer.concat([png, Buffer.alloc(FAVICON_MAX_BYTES)])
    const endless = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024))
      },
    })
    const cases: [Promise<Response>, number, string][] = [
      [
        upload(png, 'image/png', { Origin: 'https://attacker.test' }),
        403,
        'Cross-origin requests are not allowed.',
      ],
      [
        upload(png, 'image/png', { 'Sec-Fetch-Site': 'cross-site' }),
        403,
        'Cross-origin requests are not allowed.',
      ],
      [
        save(
          new Request('http://localhost/api/settings/favicon', {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: new Uint8Array(png),
          })
        ),
        415,
        'Use multipart/form-data.',
      ],
      [upload(oversized), 413, 'Please upload a file smaller than 1 MB.'],
      [upload(png, 'image/jpeg'), 415, 'Please upload a PNG image file.'],
      [upload(jpeg), 400, 'File content is not a PNG image.'],
      [
        save(
          new Request('http://localhost/api/settings/favicon', {
            method: 'POST',
            headers: {
              'content-type': 'multipart/form-data; boundary=icon',
              'content-length': String(FAVICON_MAX_BYTES * 2),
            },
            body: 'not read',
          })
        ),
        413,
        'Request body is too large.',
      ],
      [
        save(
          new Request('http://localhost/api/settings/favicon', {
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=icon' },
            body: endless,
            duplex: 'half',
          } as RequestInit)
        ),
        413,
        'Request body is too large.',
      ],
      [
        (() => {
          const form = new FormData()
          form.set('file', 'not an uploaded file')
          return save(
            new Request('http://localhost/api/settings/favicon', {
              method: 'POST',
              body: form,
            })
          )
        })(),
        400,
        'No file provided',
      ],
    ]
    for (const [pending, status, error] of cases) {
      const response = await pending
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error })
    }
    expect(state.favicon).toBeNull()
    expect(await storedObjects()).toEqual([])
  })

  it('queues each replaced image once and never the saved one, however saves interleave', async () => {
    await upload(png)
    const results = await Promise.all([
      remove(
        new Request('http://localhost/api/settings/favicon', {
          method: 'DELETE',
        })
      ),
      upload(otherPng),
      upload(png),
      remove(
        new Request('http://localhost/api/settings/favicon', {
          method: 'DELETE',
        })
      ),
      upload(otherPng),
    ])
    expect(results.map(({ status }) => status)).toEqual([
      200, 200, 200, 200, 200,
    ])
    const paths = state.queued.map(({ path }) => path)
    expect(new Set(paths).size).toBe(paths.length)
    await runCleanup()
    const saved = state.favicon
    expect(await storedObjects()).toEqual(saved ? [keyOf(saved)] : [])
    if (saved) expect((await fetchIcon(saved)).status).toBe(200)
  })

  it('never waits on storage while holding the settings lock', async () => {
    await upload(png)
    const calls: number[] = []
    for (const method of [
      'getFileSize',
      'getFileStream',
      'uploadFile',
      'deleteFile',
    ] as const) {
      const original = provider[method].bind(provider) as (
        ...args: unknown[]
      ) => Promise<unknown>
      vi.spyOn(provider, method).mockImplementation(((...args: unknown[]) => {
        calls.push(transactions.open)
        return original(...args)
      }) as never)
    }
    await upload(otherPng)
    await remove(
      new Request('http://localhost/api/settings/favicon', {
        method: 'DELETE',
      })
    )
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((open) => open === 0)).toBe(true)
  })

  it("still saves when storage can't say where the replaced favicon is, queuing both places", async () => {
    const { url } = await (await upload(png)).json()
    vi.spyOn(provider, 'getFileSize').mockRejectedValueOnce(
      new Error('storage unavailable')
    )
    const { url: next } = await (await upload(otherPng)).json()
    expect(state.favicon).toBe(next)
    expect(state.queued.map(({ path }) => path)).toEqual([
      `uploads/favicons/${keyOf(url)}`,
      LEGACY,
    ])
  })

  it('keeps a failed upload from being linked and deletes its image', async () => {
    const { url } = await (await upload(png)).json()
    const config = await import('@/lib/config')
    vi.spyOn(config, 'applyConfigUpdate').mockRejectedValueOnce(
      new Error('database unavailable')
    )
    expect((await upload(otherPng)).status).toBe(500)
    expect(state.favicon).toBe(url)
    expect(await storedObjects()).toEqual([keyOf(url)])
  })

  it("links pages only to the favicon saved now, never alongside Flare's icon", async () => {
    // Given both, browsers picked differently, so a custom favicon showed
    // in some browsers only.
    const svg = { url: '/icon.svg', type: 'image/svg+xml' }
    expect((await generateMetadata()).icons).toEqual({ icon: svg })
    state.favicon = `/api/favicon?v=${version(png)}`
    expect((await generateMetadata()).icons).toEqual({
      icon: { url: state.favicon, type: 'image/png' },
    })
    state.favicon = null
    expect((await generateMetadata()).icons).toEqual({ icon: svg })
  })
})
