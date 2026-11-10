import { describe, expect, it } from 'vitest'

import { CHUNK_SIZE, HEADER_LENGTH, STORED_CHUNK_SIZE } from '@/lib/e2ee/file'
import {
  type LocalResource,
  type PortMessage,
  type WorkerMessage,
  localAddressPath,
} from '@/lib/e2ee/sw/protocol'
import {
  type ServicePort,
  type ServiceRequest,
  createLocalAddressService,
} from '@/lib/e2ee/sw/service'

import {
  encrypted,
  expectSameBytes,
  fakeServer,
  fileKey,
  header,
  plaintextOf,
} from './support'

const ORIGIN = 'https://flare.example'
const FILE = '/api/files/alexm/e_AAAAAAAAAAAAAAAAAAAAAA'
const TOKEN = 'T'.repeat(43)
const PAGE = 'page-1'

function port() {
  const sent: PortMessage[] = []
  const value: ServicePort & { sent: PortMessage[] } = {
    sent,
    postMessage: (message) => void sent.push(message),
    onmessage: null,
  }
  return value
}

function request(
  token: string,
  options: {
    range?: string
    mode?: string
    destination?: string
    method?: string
  } = {}
): ServiceRequest {
  return {
    url: `${ORIGIN}${localAddressPath(token)}`,
    method: options.method ?? 'GET',
    mode: options.mode ?? 'no-cors',
    destination: options.destination ?? 'video',
    headers: new Headers(options.range ? { Range: options.range } : {}),
  }
}

async function setup(length: number, waitMs = 30) {
  const plaintext = plaintextOf(length)
  const stored = await encrypted(plaintext)
  const server = fakeServer({ [FILE]: stored })
  const notices: { clientId: string; message: WorkerMessage }[] = []
  const service = createLocalAddressService({
    origin: ORIGIN,
    fetch: server.fetch,
    notify: (clientId, message) => void notices.push({ clientId, message }),
    waitMs,
  })
  const resource = (overrides: Partial<LocalResource> = {}): LocalResource => ({
    token: TOKEN,
    mode: 'media',
    contentType: 'video/mp4',
    source: {
      kind: 'file',
      url: FILE,
      fileKey: fileKey.slice(),
      header: header.slice(),
      storedLength: stored.length,
    },
    ...overrides,
  })
  return { plaintext, stored, server, service, notices, resource }
}

async function body(response: Response) {
  return new Uint8Array(await response.arrayBuffer())
}

describe('requests the worker must leave alone', () => {
  it('does not answer pages, the API, static files or other origins', async () => {
    const { service } = await setup(10)
    for (const url of [
      `${ORIGIN}/`,
      `${ORIGIN}/dashboard`,
      `${ORIGIN}/alexm/e_AAAAAAAAAAAAAAAAAAAAAA`,
      `${ORIGIN}${FILE}`,
      `${ORIGIN}/api/auth/session`,
      `${ORIGIN}/_next/static/chunks/main.js`,
      `${ORIGIN}/_next/static/service-worker/sw.js`,
      `https://other.example${localAddressPath(TOKEN)}`,
      `https://cdn.example/font.woff2`,
      'not a url',
    ])
      expect(
        service.handle({ ...request(TOKEN), url, mode: 'navigate' }, ''),
        url
      ).toBeNull()
  })

  it('answers 404 for an address nobody registers', async () => {
    const { service, notices } = await setup(10)
    const response = await service.handle(request(TOKEN), PAGE)!
    expect(response.status).toBe(404)
    expect(response.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // It asked the page that sent the request, and only for the token.
    expect(notices).toEqual([
      { clientId: PAGE, message: { type: 'flare-local-need', token: TOKEN } },
    ])
  })

  it('answers 404 for a path under the prefix that is not a token', async () => {
    const { service, notices } = await setup(10)
    const response = await service.handle(
      { ...request(TOKEN), url: `${ORIGIN}/_flare/local/nope` },
      PAGE
    )!
    expect(response.status).toBe(404)
    expect(notices).toHaveLength(0)
  })
})

describe('a registration', () => {
  it('is confirmed over its port', async () => {
    const { service, resource } = await setup(10)
    const reply = port()
    expect(service.register(resource(), PAGE, reply)).toBe(true)
    expect(reply.sent).toEqual([{ type: 'registered' }])
    expect(service.size).toBe(1)
  })

  it.each([
    ['HTML as media', { contentType: 'text/html' }],
    ['SVG as media', { contentType: 'image/svg+xml' }],
    ['HTML in a frame', { mode: 'frame', contentType: 'text/html' }],
    ['a bad token', { token: 'short' }],
    ['an unknown mode', { mode: 'page' }],
  ] as [string, Partial<LocalResource>][])(
    'refuses %s',
    async (_n, overrides) => {
      const { service, resource } = await setup(10)
      const reply = port()
      expect(service.register(resource(overrides), PAGE, reply)).toBe(false)
      expect(reply.sent[0].type).toBe('refused')
      expect(service.size).toBe(0)
    }
  )

  it.each([
    'https://other.example/api/files/a/b',
    '/api/profile/export',
    '/api/auth/e2ee/keys',
    '/dashboard',
    '/api/files/a/b?download=true',
    '//other.example/api/files/a/b',
    '/api/files/../auth/session',
  ])('refuses the source address %s', async (url) => {
    const { service, resource } = await setup(10)
    const base = resource()
    const reply = port()
    service.register({ ...base, source: { ...base.source, url } }, PAGE, reply)
    expect(reply.sent[0].type).toBe('refused')
  })

  it('refuses a key of the wrong length and a header it does not know', async () => {
    const { service, resource } = await setup(10)
    const base = resource()
    if (base.source.kind !== 'file') throw new Error()
    const reply = port()
    service.register(
      { ...base, source: { ...base.source, fileKey: new Uint8Array(31) } },
      PAGE,
      reply
    )
    const unknown = header.slice()
    unknown[8] = 2
    service.register(
      { ...base, source: { ...base.source, header: unknown } },
      PAGE,
      reply
    )
    expect(reply.sent.map((message) => message.type)).toEqual([
      'refused',
      'refused',
    ])
  })

  it('does not let a second page take an address', async () => {
    const { service, resource } = await setup(10)
    service.register(resource(), PAGE, null)
    const reply = port()
    expect(service.register(resource(), 'page-2', reply)).toBe(false)
    expect(reply.sent[0]).toEqual({
      type: 'refused',
      reason: 'The address belongs to another page',
    })
  })

  it('needs a page: a message without a client registers nothing', async () => {
    const { service, resource } = await setup(10)
    expect(service.register(resource(), '', null)).toBe(false)
  })
})

describe('a media element', () => {
  it('gets the bytes of a range with 206, and only those chunks are fetched', async () => {
    const length = 40 * CHUNK_SIZE + 321
    const { plaintext, server, service, resource } = await setup(length)
    service.register(resource(), PAGE, null)
    const start = 30 * CHUNK_SIZE + 17
    const end = 30 * CHUNK_SIZE + 5000
    const response = await service.handle(
      request(TOKEN, { range: `bytes=${start}-${end - 1}` }),
      PAGE
    )!
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(
      `bytes ${start}-${end - 1}/${length}`
    )
    expect(response.headers.get('content-length')).toBe(String(end - start))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
    expect(response.headers.get('content-disposition')).toBe('inline')
    expectSameBytes(await body(response), plaintext.subarray(start, end))
    // The final chunk, which proves the length, and chunk 30.
    expect(server.requests.map((entry) => entry.range)).toEqual([
      `bytes=${HEADER_LENGTH + 40 * STORED_CHUNK_SIZE}-${HEADER_LENGTH + 40 * STORED_CHUNK_SIZE + 321 + 32 - 1}`,
      `bytes=${HEADER_LENGTH + 30 * STORED_CHUNK_SIZE}-${HEADER_LENGTH + 31 * STORED_CHUNK_SIZE - 1}`,
    ])
    const fetched = server.requests.reduce((sum, entry) => sum + entry.bytes, 0)
    expect(fetched).toBeLessThan(2 * STORED_CHUNK_SIZE)
  })

  it('gets an open range to the end, read only as far as the player reads', async () => {
    const length = 100 * CHUNK_SIZE
    const { plaintext, server, service, resource } = await setup(length)
    service.register(resource(), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { range: 'bytes=0-' }),
      PAGE
    )!
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(
      `bytes 0-${length - 1}/${length}`
    )
    const reader = response.body!.getReader()
    const first = await reader.read()
    expectSameBytes(first.value!, plaintext.subarray(0, CHUNK_SIZE))
    await reader.cancel()
    const fetched = server.requests.reduce((sum, entry) => sum + entry.bytes, 0)
    // The final chunk and one window of 4 chunks, of 100.
    expect(fetched).toBeLessThanOrEqual(5 * STORED_CHUNK_SIZE)
  })

  it('gets 200 and the whole file without a Range header', async () => {
    const { plaintext, service, resource } = await setup(3 * CHUNK_SIZE + 5)
    service.register(resource({ contentType: 'audio/mpeg' }), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { destination: 'audio' }),
      PAGE
    )!
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(
      String(plaintext.length)
    )
    expect(response.headers.get('content-range')).toBeNull()
    expectSameBytes(await body(response), plaintext)
  })

  it('gets a suffix range', async () => {
    const { plaintext, service, resource } = await setup(2 * CHUNK_SIZE + 9)
    service.register(resource(), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { range: 'bytes=-100' }),
      PAGE
    )!
    expect(response.status).toBe(206)
    expectSameBytes(
      await body(response),
      plaintext.subarray(plaintext.length - 100)
    )
  })

  it('gets 416 for a range outside the file', async () => {
    const { service, resource } = await setup(1000)
    service.register(resource(), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { range: 'bytes=1000-' }),
      PAGE
    )!
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */1000')
    expect(response.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
  })

  it('gets headers and no body for HEAD', async () => {
    const { server, service, resource } = await setup(1000)
    service.register(resource(), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { method: 'HEAD' }),
      PAGE
    )!
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('1000')
    expect(await body(response)).toHaveLength(0)
    expect(server.requests).toHaveLength(0)
  })

  it('cannot use another method', async () => {
    const { service, resource } = await setup(10)
    service.register(resource(), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { method: 'POST' }),
      PAGE
    )!
    expect(response.status).toBe(405)
  })

  it('finds the length itself when the page does not know it', async () => {
    const { plaintext, server, service, resource } = await setup(
      CHUNK_SIZE + 77
    )
    const base = resource()
    if (base.source.kind !== 'file') throw new Error()
    service.register(
      { ...base, source: { ...base.source, storedLength: undefined } },
      PAGE,
      null
    )
    const response = await service.handle(
      request(TOKEN, { range: 'bytes=0-9' }),
      PAGE
    )!
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(
      `bytes 0-9/${plaintext.length}`
    )
    expect(server.requests[0].range).toBe('bytes=0-25')
  })
})

describe('the navigation attack', () => {
  it('refuses a navigation to a media address, with the guard headers', async () => {
    const { server, service, resource } = await setup(1000)
    service.register(resource(), PAGE, null)
    for (const destination of ['document', 'iframe', 'embed', 'object']) {
      const response = await service.handle(
        request(TOKEN, { mode: 'navigate', destination }),
        ''
      )!
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toBe(
        'text/plain; charset=utf-8'
      )
      expect(response.headers.get('content-security-policy')).toBe(
        "sandbox; default-src 'none'"
      )
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    }
    expect(server.requests).toHaveLength(0)
  })

  it('refuses another page of the same origin', async () => {
    const { service, resource } = await setup(1000)
    service.register(resource(), PAGE, null)
    const response = await service.handle(request(TOKEN), 'page-2')!
    expect(response.status).toBe(403)
  })

  it('refuses script of the owning page for a media address', async () => {
    const { service, resource } = await setup(1000)
    service.register(resource(), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { mode: 'cors', destination: '' }),
      PAGE
    )!
    expect(response.status).toBe(403)
  })

  it('serves a hostile file only as an attachment of the generic type', async () => {
    const { plaintext, service, resource } = await setup(500)
    service.register(
      resource({
        mode: 'download',
        contentType: 'text/html',
        filename: 'page.html',
      }),
      PAGE,
      null
    )
    const response = await service.handle(
      request(TOKEN, { mode: 'navigate', destination: 'document' }),
      ''
    )!
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="page.html"; filename*=UTF-8''page.html`
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
    expectSameBytes(await body(response), plaintext)
  })
})

describe('a PDF in a frame', () => {
  it('answers a frame navigation at the labelled address and nothing else', async () => {
    const { plaintext, service, resource } = await setup(3 * CHUNK_SIZE + 7)
    service.register(
      resource({ mode: 'frame', contentType: 'application/pdf' }),
      PAGE,
      null
    )
    const address = `${ORIGIN}${localAddressPath(TOKEN, 'frame')}`
    expect(address.endsWith(`/${TOKEN}/document.pdf`)).toBe(true)
    const frame = { mode: 'navigate', destination: 'iframe' }
    const response = await service.handle(
      { ...request(TOKEN, frame), url: address },
      ''
    )!
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(response.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'"
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('accept-ranges')).toBeNull()
    expectSameBytes(await body(response), plaintext)
    // A tab, a script and a media element get nothing from it.
    for (const [shape, client] of [
      [{ mode: 'navigate', destination: 'document' }, ''],
      [{ mode: 'cors', destination: '' }, PAGE],
      [{ mode: 'no-cors', destination: 'video' }, PAGE],
    ] as const) {
      const refused = await service.handle(
        { ...request(TOKEN, shape), url: address },
        client
      )!
      expect(refused.status, JSON.stringify(shape)).toBe(403)
    }
    // No other last part is an address.
    const other = await service.handle(
      {
        ...request(TOKEN, frame),
        url: `${ORIGIN}/_flare/local/${TOKEN}/x.pdf`,
      },
      ''
    )!
    expect(other.status).toBe(404)
  })
})

describe('a download', () => {
  it('streams the whole file in one counted request and answers one time', async () => {
    const { plaintext, server, service, notices, resource } = await setup(
      20 * CHUNK_SIZE + 3
    )
    service.register(
      resource({ mode: 'download', filename: 'a.bin', countDownload: true }),
      PAGE,
      null
    )
    const navigation = request(TOKEN, {
      mode: 'navigate',
      destination: 'iframe',
    })
    const response = await service.handle(navigation, '')!
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(
      String(plaintext.length)
    )
    expectSameBytes(await body(response), plaintext)
    expect(server.requests.map((entry) => entry.url)).toEqual([
      FILE,
      `${FILE}?download=true`,
    ])
    expect(notices.map((notice) => notice.message.type)).toEqual([
      'flare-local-started',
      'flare-local-finished',
    ])
    // The address is gone: a second navigation finds nothing.
    expect(service.size).toBe(0)
    expect((await service.handle(navigation, '')!).status).toBe(404)
  })

  it('reports a cancelled download and stops reading', async () => {
    const { server, service, notices, resource } = await setup(200 * CHUNK_SIZE)
    service.register(resource({ mode: 'download' }), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { mode: 'navigate', destination: 'iframe' }),
      ''
    )!
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    expect(notices.at(-1)?.message).toEqual({
      type: 'flare-local-failed',
      token: TOKEN,
      reason: 'cancelled',
    })
    expect(service.size).toBe(0)
    expect(server.requests).toHaveLength(2)
  })
})

describe('a file that was changed or cut', () => {
  it('is refused before any byte when the stored length is not its end', async () => {
    const plaintext = plaintextOf(6 * CHUNK_SIZE)
    const stored = await encrypted(plaintext)
    const cut = stored.slice(0, HEADER_LENGTH + 4 * STORED_CHUNK_SIZE)
    const server = fakeServer({ [FILE]: cut })
    const notices: WorkerMessage[] = []
    const service = createLocalAddressService({
      origin: ORIGIN,
      fetch: server.fetch,
      notify: (_client, message) => void notices.push(message),
    })
    service.register(
      {
        token: TOKEN,
        mode: 'media',
        contentType: 'video/mp4',
        source: {
          kind: 'file',
          url: FILE,
          fileKey: fileKey.slice(),
          header: header.slice(),
          storedLength: cut.length,
        },
      },
      PAGE,
      null
    )
    // The first bytes are authentic chunks. They are still not given out:
    // the player would show a cut file as a complete one.
    const response = await service.handle(
      request(TOKEN, { range: 'bytes=0-99' }),
      PAGE
    )!
    expect(response.status).toBe(502)
    expect(await response.text()).toBe(
      'This file did not pass its integrity check.'
    )
    expect(notices).toEqual([
      { type: 'flare-local-failed', token: TOKEN, reason: 'integrity' },
    ])
  })

  it('breaks the transfer at a chunk whose tag is wrong', async () => {
    const { stored, service, notices, resource } = await setup(10 * CHUNK_SIZE)
    stored[HEADER_LENGTH + 6 * STORED_CHUNK_SIZE + 4] ^= 0x80
    service.register(resource({ mode: 'download' }), PAGE, null)
    const response = await service.handle(
      request(TOKEN, { mode: 'navigate', destination: 'iframe' }),
      ''
    )!
    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow()
    expect(notices.at(-1)?.message).toEqual({
      type: 'flare-local-failed',
      token: TOKEN,
      reason: 'integrity',
    })
    expect(notices.some((n) => n.message.type === 'flare-local-finished')).toBe(
      false
    )
  })

  it('reports a file the server no longer sends', async () => {
    const { server, service, notices, resource } = await setup(100)
    service.register(resource(), PAGE, null)
    server.state.status = 404
    const response = await service.handle(request(TOKEN), PAGE)!
    expect(response.status).toBe(404)
    expect(notices.at(-1)?.message).toEqual({
      type: 'flare-local-failed',
      token: TOKEN,
      reason: 'refused',
    })
  })
})

describe('a worker that the browser stopped', () => {
  it('asks the page for the address and answers when the page registers it again', async () => {
    const { plaintext, service, notices, resource } = await setup(
      2 * CHUNK_SIZE,
      2000
    )
    // A new worker: nothing is registered.
    const pending = service.handle(
      request(TOKEN, { range: 'bytes=5-14' }),
      PAGE
    )!
    await Promise.resolve()
    expect(notices).toEqual([
      { clientId: PAGE, message: { type: 'flare-local-need', token: TOKEN } },
    ])
    service.register(resource(), PAGE, null)
    const response = await pending
    expect(response.status).toBe(206)
    expectSameBytes(await body(response), plaintext.subarray(5, 15))
  })

  it('asks every window for a navigation, which has no client', async () => {
    const { service, notices, resource } = await setup(100, 2000)
    const pending = service.handle(
      request(TOKEN, { mode: 'navigate', destination: 'iframe' }),
      ''
    )!
    await Promise.resolve()
    expect(notices[0]).toEqual({
      clientId: '',
      message: { type: 'flare-local-need', token: TOKEN },
    })
    service.register(resource({ mode: 'download' }), PAGE, null)
    expect((await pending).status).toBe(200)
  })
})

describe('keys', () => {
  it('are dropped for every page at sign-out, and a running transfer stops', async () => {
    const { service, resource } = await setup(100 * CHUNK_SIZE)
    service.register(resource(), PAGE, null)
    service.register(resource({ token: 'U'.repeat(43) }), 'page-2', null)
    const response = await service.handle(
      request(TOKEN, { range: 'bytes=0-' }),
      PAGE
    )!
    const reader = response.body!.getReader()
    await reader.read()
    service.dropAll()
    expect(service.size).toBe(0)
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) return
      })()
    ).rejects.toThrow()
    expect((await service.handle(request(TOKEN), PAGE)!).status).toBe(404)
  })

  it('are released by the page that owns them and by no other page', async () => {
    const { service, resource } = await setup(100)
    service.register(resource(), PAGE, null)
    service.release([TOKEN], 'page-2')
    expect(service.size).toBe(1)
    service.release([TOKEN], PAGE)
    expect(service.size).toBe(0)
  })

  it('go with the pages that are gone', async () => {
    const { service, resource } = await setup(100)
    service.register(resource(), PAGE, null)
    service.register(resource({ token: 'U'.repeat(43) }), 'page-2', null)
    service.keepOnly(new Set(['page-2']))
    expect(service.size).toBe(1)
  })

  it('are not in any request the worker sends', async () => {
    const { server, service, resource } = await setup(3 * CHUNK_SIZE)
    service.register(
      resource({ mode: 'download', filename: 'secret-name.bin' }),
      PAGE,
      null
    )
    await (
      await service.handle(
        request(TOKEN, { mode: 'navigate', destination: 'iframe' }),
        ''
      )!
    ).arrayBuffer()
    const key = Buffer.from(fileKey).toString('base64url')
    for (const entry of server.requests) {
      expect(entry.url.split('?')[0]).toBe(FILE)
      expect(JSON.stringify(entry)).not.toContain(key)
      expect(JSON.stringify(entry)).not.toContain('secret-name')
      expect(JSON.stringify(entry)).not.toContain(TOKEN)
    }
  })
})

describe('entries of an archive', () => {
  it('serve a part of the file, and share the proof of its length', async () => {
    const { plaintext, server, service, resource } = await setup(
      30 * CHUNK_SIZE
    )
    const base = resource()
    if (base.source.kind !== 'file') throw new Error()
    const member = (token: string, offset: number, length: number) =>
      service.register(
        {
          ...base,
          token,
          contentType: 'image/png',
          source: {
            ...base.source,
            fileKey: fileKey.slice(),
            member: { kind: 'stored', offset, length },
          },
        },
        PAGE,
        null
      )
    const first = 'F'.repeat(43)
    const second = 'S'.repeat(43)
    member(first, 5 * CHUNK_SIZE + 10, 1000)
    member(second, 20 * CHUNK_SIZE, 70_000)
    const one = await service.handle(
      request(first, { destination: 'image' }),
      PAGE
    )!
    expect(one.status).toBe(200)
    expect(one.headers.get('content-length')).toBe('1000')
    expectSameBytes(
      await body(one),
      plaintext.subarray(5 * CHUNK_SIZE + 10, 5 * CHUNK_SIZE + 1010)
    )
    const two = await service.handle(
      request(second, { destination: 'image', range: 'bytes=65000-69999' }),
      PAGE
    )!
    expect(two.status).toBe(206)
    expect(two.headers.get('content-range')).toBe('bytes 65000-69999/70000')
    expectSameBytes(
      await body(two),
      plaintext.subarray(20 * CHUNK_SIZE + 65000, 20 * CHUNK_SIZE + 70000)
    )
    // One request proved the end of the file for both addresses.
    const tail = server.requests.filter((entry) =>
      entry.range?.endsWith(`-${26 + 30 * STORED_CHUNK_SIZE - 1}`)
    )
    expect(tail).toHaveLength(1)
    // Releasing one address keeps the file open for the other.
    service.release([first], PAGE)
    expect(
      (await service.handle(request(second, { destination: 'image' }), PAGE)!)
        .status
    ).toBe(200)
  })

  it('refuses an entry that reaches outside the file', async () => {
    const { service, notices, resource } = await setup(CHUNK_SIZE)
    const base = resource()
    if (base.source.kind !== 'file') throw new Error()
    service.register(
      {
        ...base,
        contentType: 'image/png',
        source: {
          ...base.source,
          member: { kind: 'stored', offset: CHUNK_SIZE - 10, length: 100 },
        },
      },
      PAGE,
      null
    )
    const response = await service.handle(
      request(TOKEN, { destination: 'image' }),
      PAGE
    )!
    expect(response.status).toBe(502)
    expect(notices.at(-1)?.message).toMatchObject({ reason: 'integrity' })
  })
})

describe('a download that the page feeds', () => {
  it('pulls one piece at a time and ends when the page ends it', async () => {
    const { service, notices } = await setup(10)
    const feed = port()
    service.register(
      {
        token: TOKEN,
        mode: 'download',
        contentType: 'application/zip',
        filename: 'export.zip',
        source: { kind: 'feed' },
      },
      PAGE,
      feed
    )
    const response = await service.handle(
      request(TOKEN, { mode: 'navigate', destination: 'iframe' }),
      ''
    )!
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-disposition')).toContain('export.zip')
    const reader = response.body!.getReader()
    const read = reader.read()
    await Promise.resolve()
    // The worker asked for one piece and waits.
    expect(feed.sent.filter((message) => message.type === 'pull')).toHaveLength(
      1
    )
    feed.onmessage!({ data: { type: 'chunk', bytes: Uint8Array.of(1, 2, 3) } })
    expect((await read).value).toEqual(Uint8Array.of(1, 2, 3))
    const next = reader.read()
    await new Promise((resolve) => setTimeout(resolve, 5))
    feed.onmessage!({ data: { type: 'end' } })
    expect((await next).done).toBe(true)
    expect(notices.map((notice) => notice.message.type)).toEqual([
      'flare-local-started',
      'flare-local-finished',
    ])
  })

  it('is only for a download', async () => {
    const { service } = await setup(10)
    const feed = port()
    expect(
      service.register(
        {
          token: TOKEN,
          mode: 'media',
          contentType: 'video/mp4',
          source: { kind: 'feed' },
        },
        PAGE,
        feed
      )
    ).toBe(false)
  })
})
