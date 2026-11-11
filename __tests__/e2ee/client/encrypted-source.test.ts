import { describe, expect, it } from 'vitest'

import {
  SourceError,
  openEncryptedSource,
  probeStoredLength,
} from '@/lib/e2ee/client/encrypted-source'
import { E2eeError } from '@/lib/e2ee/errors'
import {
  CHUNK_SIZE,
  HEADER_LENGTH,
  STORED_CHUNK_SIZE,
  storedLengthOf,
} from '@/lib/e2ee/file'

import {
  bytesOf,
  encrypted,
  expectSameBytes,
  fakeServer,
  fileKey,
  header,
  plaintextOf,
} from '../sw/support'

const URL = '/api/files/alexm/e_AAAAAAAAAAAAAAAAAAAAAA'

async function fixture(length: number, pieceBytes?: number) {
  const plaintext = plaintextOf(length)
  const stored = await encrypted(plaintext)
  const server = fakeServer({ [URL]: stored }, { pieceBytes })
  const source = openEncryptedSource({
    url: URL,
    fileKey,
    header,
    storedLength: stored.length,
    fetch: server.fetch,
  })
  return { plaintext, stored, server, source }
}

async function reasonOf(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof E2eeError) return error.reason
    if (error instanceof SourceError) return `source:${error.failure}`
    throw error
  }
  return 'no error'
}

describe('reading ranges of an encrypted file', () => {
  it('maps a plaintext range to the stored chunks that hold it', async () => {
    const { plaintext, server, source } = await fixture(5 * CHUNK_SIZE + 1234)
    const start = 2 * CHUNK_SIZE + 100
    const end = 3 * CHUNK_SIZE + 7
    expectSameBytes(
      await source.read(start, end),
      plaintext.subarray(start, end)
    )
    // Chunks 2 and 3, and nothing else.
    expect(server.requests).toEqual([
      {
        url: URL,
        range: `bytes=${HEADER_LENGTH + 2 * STORED_CHUNK_SIZE}-${HEADER_LENGTH + 4 * STORED_CHUNK_SIZE - 1}`,
        bytes: 2 * STORED_CHUNK_SIZE,
      },
    ])
  })

  it.each([
    ['one byte at the start', 0, 1],
    ['the last byte of a chunk', CHUNK_SIZE - 1, CHUNK_SIZE],
    ['the first byte of the next chunk', CHUNK_SIZE, CHUNK_SIZE + 1],
    ['across a chunk border', CHUNK_SIZE - 3, CHUNK_SIZE + 3],
    ['the final byte', 3 * CHUNK_SIZE + 99, 3 * CHUNK_SIZE + 100],
    ['the whole file', 0, 3 * CHUNK_SIZE + 100],
  ])('reads %s', async (_name, start, end) => {
    const { plaintext, source } = await fixture(3 * CHUNK_SIZE + 100, 777)
    expectSameBytes(
      await source.read(start, end),
      plaintext.subarray(start, end)
    )
  })

  it('reads a range that ends in a final chunk of exactly 64 KiB', async () => {
    const { plaintext, source } = await fixture(2 * CHUNK_SIZE)
    expectSameBytes(
      await source.read(CHUNK_SIZE + 5, 2 * CHUNK_SIZE),
      plaintext.subarray(CHUNK_SIZE + 5)
    )
  })

  it('gives an empty file no bytes and still proves its end', async () => {
    const { source, server } = await fixture(0)
    expect(source.plaintextLength).toBe(0)
    expect(await bytesOf(source.stream(0, 0))).toHaveLength(0)
    await source.verifyEnd()
    expect(server.requests).toHaveLength(1)
  })

  it('refuses a range outside the file', async () => {
    const { source } = await fixture(1000)
    expect(await reasonOf(() => source.read(0, 1001))).toBe('invalid_range')
    expect(await reasonOf(() => source.read(5, 4))).toBe('invalid_range')
    expect(await reasonOf(() => source.read(-1, 4))).toBe('invalid_range')
  })

  it('asks in windows that grow, so a reader that stops early wastes little', async () => {
    const { plaintext, server, source } = await fixture(200 * CHUNK_SIZE)
    const stream = source.stream(0, plaintext.length)
    const first = await stream.next()
    expectSameBytes(first.value!, plaintext.subarray(0, CHUNK_SIZE))
    await stream.return(undefined)
    // One request for the first 4 chunks of 200.
    expect(server.requests.map((request) => request.bytes)).toEqual([
      4 * STORED_CHUNK_SIZE,
    ])

    server.requests.length = 0
    expectSameBytes(
      await bytesOf(source.stream(0, plaintext.length)),
      plaintext
    )
    const sizes = server.requests.map(
      (request) => request.bytes / STORED_CHUNK_SIZE
    )
    expect(sizes.slice(0, 5)).toEqual([4, 8, 16, 32, 64])
    expect(Math.max(...sizes)).toBe(64)
  })

  it('reads a download in one request, which is the one that counts', async () => {
    const { plaintext, server, source } = await fixture(9 * CHUNK_SIZE + 5)
    expectSameBytes(
      await bytesOf(
        source.stream(0, plaintext.length, {
          window: 'whole',
          countDownload: true,
        })
      ),
      plaintext
    )
    expect(server.requests.map((request) => request.url)).toEqual([
      `${URL}?download=true`,
    ])
  })

  it('reports the stored bytes of each request', async () => {
    const { plaintext, source } = await fixture(10 * CHUNK_SIZE)
    const asked: number[] = []
    await bytesOf(
      source.stream(0, plaintext.length, {
        window: 3,
        onRequest: (bytes) => asked.push(bytes),
      })
    )
    expect(asked).toEqual([
      3 * STORED_CHUNK_SIZE,
      3 * STORED_CHUNK_SIZE,
      3 * STORED_CHUNK_SIZE,
      STORED_CHUNK_SIZE,
    ])
  })
})

describe('what a changed or cut file does', () => {
  it('gives no byte of a chunk whose tag is wrong', async () => {
    const { stored, source } = await fixture(3 * CHUNK_SIZE)
    stored[HEADER_LENGTH + STORED_CHUNK_SIZE + 10] ^= 1
    const stream = source.stream(0, 3 * CHUNK_SIZE)
    expect((await stream.next()).done).toBe(false)
    expect(await reasonOf(() => stream.next())).toBe('tag_mismatch')
  })

  it('does not accept a file that the server cut at a chunk border', async () => {
    const plaintext = plaintextOf(4 * CHUNK_SIZE + 10)
    const stored = await encrypted(plaintext)
    // The server drops the last two chunks and reports the shorter length.
    const cut = stored.slice(0, HEADER_LENGTH + 3 * STORED_CHUNK_SIZE)
    const server = fakeServer({ [URL]: cut })
    const source = openEncryptedSource({
      url: URL,
      fileKey,
      header,
      storedLength: cut.length,
      fetch: server.fetch,
    })
    // The ranges before the cut are authentic chunks of the file.
    expectSameBytes(await source.read(0, 100), plaintext.subarray(0, 100))
    // The end is not: chunk 2 was not stored as the final chunk.
    expect(await reasonOf(() => source.verifyEnd())).toBe('tag_mismatch')
    expect(await reasonOf(() => source.read(0, 3 * CHUNK_SIZE))).toBe(
      'tag_mismatch'
    )
  })

  it('does not accept a longer length than the file has', async () => {
    const { stored, server } = await fixture(CHUNK_SIZE + 5)
    const source = openEncryptedSource({
      url: URL,
      fileKey,
      header,
      storedLength: stored.length + STORED_CHUNK_SIZE,
      fetch: server.fetch,
    })
    expect(await reasonOf(() => source.verifyEnd())).toBe('source:changed')
  })

  it('does not accept a server that reports a different total', async () => {
    const { stored, server } = await fixture(2 * CHUNK_SIZE)
    const source = openEncryptedSource({
      url: URL,
      fileKey,
      header,
      storedLength: storedLengthOf(2 * CHUNK_SIZE - 1),
      fetch: server.fetch,
    })
    expect(stored.length).not.toBe(source.layout.storedLength)
    expect(await reasonOf(() => source.read(0, 10))).toBe('source:changed')
  })

  it('proves the end one time and tries again after a failed request', async () => {
    const { server, source } = await fixture(2 * CHUNK_SIZE + 1)
    server.state.status = 503
    expect(await reasonOf(() => source.verifyEnd())).toBe('source:refused')
    server.state.status = null
    await source.verifyEnd()
    await source.verifyEnd()
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1].bytes).toBe(1 + 32)
  })

  it('names a refusal of the server with its status', async () => {
    const { server, source } = await fixture(10)
    server.state.status = 404
    await expect(source.read(0, 10)).rejects.toMatchObject({
      failure: 'refused',
      status: 404,
    })
  })

  it('reads nothing after it is closed', async () => {
    const { source } = await fixture(10)
    source.close()
    expect(await reasonOf(() => source.read(0, 10))).toBe('invalid_argument')
  })

  it('stops the request when the reader stops', async () => {
    const { source } = await fixture(64 * CHUNK_SIZE)
    const abort = new AbortController()
    const stream = source.stream(0, 64 * CHUNK_SIZE, { signal: abort.signal })
    await stream.next()
    abort.abort()
    await expect(bytesOf(stream)).rejects.toThrow()
  })
})

describe('the stored length of a file the page has only the address of', () => {
  it('is the total of the answer to a request for the header', async () => {
    const { stored, server } = await fixture(3 * CHUNK_SIZE + 9)
    expect(
      await probeStoredLength({ url: URL, header, fetch: server.fetch })
    ).toBe(stored.length)
    expect(server.requests).toEqual([
      { url: URL, range: 'bytes=0-25', bytes: 26 },
    ])
  })

  it('refuses a file with a different header', async () => {
    const { server } = await fixture(100)
    const other = header.slice()
    other[20] ^= 1
    expect(
      await reasonOf(() =>
        probeStoredLength({ url: URL, header: other, fetch: server.fetch })
      )
    ).toBe('source:changed')
  })
})
