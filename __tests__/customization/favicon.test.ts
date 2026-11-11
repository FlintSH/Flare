import { GET as serve } from '@/app/api/favicon/route'
import {
  DELETE as remove,
  POST as save,
} from '@/app/api/settings/favicon/route'
import { generateMetadata } from '@/app/layout'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
}))
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'inter' }) }))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => ({
    user: { id: 'manager', permissions: ['appearance.manage'] },
  }),
}))
// Transactions hold the favicon lock until they end, as PostgreSQL's
// transaction-scoped advisory lock does.
const faviconLock = vi.hoisted(() => {
  let tail = Promise.resolve()
  return {
    acquire() {
      let release!: () => void
      const previous = tail
      tail = new Promise<void>((resolve) => (release = resolve))
      return previous.then(() => release)
    },
  }
})
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $transaction: async (
      run: (tx: { hold: (release: () => void) => void }) => Promise<unknown>
    ) => {
      const held: (() => void)[] = []
      try {
        return await run({ hold: (release) => held.push(release) })
      } finally {
        held.forEach((release) => release())
      }
    },
  },
}))
vi.mock('@/lib/database/locks', () => ({
  lockFavicon: async (tx: { hold: (release: () => void) => void }) =>
    tx.hold(await faviconLock.acquire()),
}))
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
  applyConfigUpdate: async (
    _tx: unknown,
    update: { settings: { appearance: { favicon: string | null } } }
  ) => {
    state.favicon = update.settings.appearance.favicon
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

  const stored = () => readFile(join(directory, 'uploads/favicon.png'))

  it('gives a replaced favicon a new address and caches only matching bytes for a year', async () => {
    const remove = vi.spyOn(provider, 'deleteFile')
    const first = await upload(png, 'image/png', { Origin: 'http://localhost' })
    expect(first.status).toBe(200)
    const { url: firstUrl } = await first.json()
    expect(state.favicon).toBe(firstUrl)

    const second = await upload(otherPng)
    const { url: secondUrl } = await second.json()
    expect(secondUrl).not.toBe(firstUrl)
    expect(state.favicon).toBe(secondUrl)
    expect(await stored()).toEqual(otherPng)
    // The new bytes replace the old ones in place; nothing deletes them first.
    expect(remove).not.toHaveBeenCalled()

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
    await provider.uploadFile(png, 'uploads/favicon.png', 'image/png')
    state.favicon = `/api/favicon?v=${version(png)}`
    const publicUrl = vi
      .spyOn(provider, 'getPublicUrl')
      .mockResolvedValue(
        'https://bucket.example.test/favicon.png?X-Amz-Signature=abc'
      )
    const response = await fetchIcon(state.favicon)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable'
    )
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
    expect(publicUrl).not.toHaveBeenCalled()
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
    await expect(stored()).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fetchIcon(url)).status).toBe(404)
    expect((await generateMetadata()).icons).toEqual({
      icon: { url: '/icon.svg', type: 'image/svg+xml' },
    })

    // Removing again, with nothing stored, still succeeds.
    expect((await removal()).status).toBe(200)
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
    await expect(stored()).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never deletes an upload saved while a removal runs', async () => {
    await upload(png)
    let finishDelete!: () => void
    const deleting = new Promise<void>((resolve) => (finishDelete = resolve))
    const deleteFile = provider.deleteFile.bind(provider)
    vi.spyOn(provider, 'deleteFile').mockImplementation(async (path) => {
      await deleting
      await deleteFile(path)
    })
    const writes = vi.spyOn(provider, 'uploadFile')

    const removal = remove(
      new Request('http://localhost/api/settings/favicon', {
        method: 'DELETE',
      })
    )
    await vi.waitFor(() => expect(provider.deleteFile).toHaveBeenCalled())
    const replacement = upload(otherPng)
    // The upload waits for the removal instead of writing under it.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writes).not.toHaveBeenCalled()
    finishDelete()

    expect((await removal).status).toBe(200)
    const { url } = await (await replacement).json()
    expect(state.favicon).toBe(url)
    expect(await stored()).toEqual(otherPng)
    expect((await fetchIcon(url)).status).toBe(200)
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
