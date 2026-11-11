import { expect } from 'vitest'

import { buildHeader, encryptFile, storedLengthOf } from '@/lib/e2ee/file'
import { asFileKey, asNoncePrefix } from '@/lib/e2ee/types'

import { collect, pattern } from '../test-support'

/** A stored encrypted file and a fake server for it. Not part of the library. */
export const fileKey = asFileKey(pattern(32, 41))
export const noncePrefix = asNoncePrefix(pattern(16, 42))
export const header = buildHeader(noncePrefix)

export function plaintextOf(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index++)
    out[index] = (index * 31 + (index >>> 16) * 7) & 0xff
  return out
}

export async function encrypted(plaintext: Uint8Array): Promise<Uint8Array> {
  const stored = await collect(encryptFile(fileKey, noncePrefix, [plaintext]))
  if (stored.length !== storedLengthOf(plaintext.length))
    throw new Error('Unexpected stored length')
  return stored
}

export interface FakeRequest {
  readonly url: string
  readonly range: string | undefined
  /** Stored bytes the request asked for. */
  readonly bytes: number
}

/**
 * A server that answers `Range` like `serveFile`: `206` with
 * `Content-Range`, or `200` with the whole file. `pieceBytes` cuts each body
 * into network pieces of that size, to show that chunk borders are found in
 * any piece size.
 */
export function fakeServer(
  files: Record<string, Uint8Array>,
  { pieceBytes = 50_000 }: { pieceBytes?: number } = {}
) {
  const requests: FakeRequest[] = []
  const state = { status: null as number | null, pieceBytes }
  const fetch = async (
    url: string,
    init: { headers?: Record<string, string>; signal?: AbortSignal }
  ): Promise<Response> => {
    init.signal?.throwIfAborted()
    const path = url.split('?')[0]
    const stored = files[path]
    const range = init.headers?.Range
    if (state.status) {
      requests.push({ url, range, bytes: 0 })
      return new Response(null, { status: state.status })
    }
    if (!stored) {
      requests.push({ url, range, bytes: 0 })
      return new Response(null, { status: 404 })
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
    const start = match ? Number(match[1]) : 0
    const end = match
      ? Math.min(Number(match[2]) + 1, stored.length)
      : stored.length
    requests.push({ url, range, bytes: end - start })
    const body = stored.subarray(start, end)
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= body.length) return controller.close()
        const next = Math.min(body.length, offset + state.pieceBytes)
        controller.enqueue(body.slice(offset, next))
        offset = next
      },
    })
    return new Response(stream, {
      status: match ? 206 : 200,
      headers: match
        ? { 'Content-Range': `bytes ${start}-${end - 1}/${stored.length}` }
        : {},
    })
  }
  return { fetch, requests, state }
}

export const bytesOf = collect

/** `toEqual` walks a typed array element by element, which is slow for megabytes. */
export function expectSameBytes(actual: Uint8Array, expected: Uint8Array) {
  expect(actual.length).toBe(expected.length)
  expect(
    Buffer.from(actual.buffer, actual.byteOffset, actual.length).equals(
      Buffer.from(expected.buffer, expected.byteOffset, expected.length)
    )
  ).toBe(true)
}
