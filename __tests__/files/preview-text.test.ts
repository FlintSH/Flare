import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadPreviewText } from '@/components/file/viewer/preview-text'

import { TransportFailure } from '@/lib/client/request'

// The preview limit the handbook states (guide/sharing.md).
const MIB = 1024 * 1024
const failed = (status?: number) => `Failed: ${status}`
const TOO_LARGE =
  'This file is too large to preview. Download it to view all its data.'

function serve(response: Response) {
  const fetch = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** A body that sends `chunks` chunks of `size` bytes and says no length. */
function stream(chunks: number, size: number) {
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === chunks) return controller.close()
      sent++
      controller.enqueue(new Uint8Array(size).fill(97))
    },
  })
  return { body, sent: () => sent }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadPreviewText', () => {
  it('returns a small file’s text, decoded like response.text()', async () => {
    const bytes = new TextEncoder().encode('﻿naïve, café\n')
    serve(new Response(bytes))
    expect(await loadPreviewText('/api/files/owner/a.csv', failed)).toBe(
      await new Response(bytes).text()
    )
  })

  it('previews a file of exactly 1 MiB', async () => {
    const { body } = stream(16, MIB / 16)
    serve(new Response(body))
    const text = await loadPreviewText('/api/files/owner/a.log', failed)
    expect(text).toHaveLength(MIB)
  })

  it('refuses a file whose stated length is over 1 MiB', async () => {
    serve(
      new Response('a', {
        headers: { 'content-length': String(MIB + 1) },
      })
    )
    await expect(
      loadPreviewText('/api/files/owner/a.log', failed)
    ).rejects.toThrow(TOO_LARGE)
  })

  // A proxy that compresses the response drops its length.
  it('stops reading once a file without a stated length passes the cap', async () => {
    const big = stream(1000, 64 * 1024)
    serve(new Response(big.body))
    await expect(
      loadPreviewText('/api/files/owner/a.log', failed)
    ).rejects.toThrow(TOO_LARGE)
    expect(big.sent()).toBeLessThan(20)
  })

  it('words a failed request with its status', async () => {
    serve(new Response('Not found', { status: 404 }))
    await expect(
      loadPreviewText('/api/files/owner/a.log', failed)
    ).rejects.toThrow('Failed: 404')
  })

  it('stops loading when its signal aborts', async () => {
    // Like fetch, the stub refuses a request whose signal has aborted.
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted()
      return new Response('x')
    })
    const controller = new AbortController()
    const reason = new DOMException('Preview abandoned', 'AbortError')
    controller.abort(reason)
    await expect(
      loadPreviewText('/api/files/owner/a.log', failed, controller.signal)
    ).rejects.toBe(reason)
  })

  it('keeps a network cause but shows friendly recovery instead of browser text', async () => {
    const cause = new TypeError('Failed to fetch')
    const fetch = vi.fn().mockRejectedValueOnce(cause)
    vi.stubGlobal('fetch', fetch)
    const pending = loadPreviewText('/api/files/owner/a.log', failed)
    await expect(pending).rejects.toBeInstanceOf(TransportFailure)
    const error = await pending.catch((error) => error)
    expect(error.cause).toBe(cause)
    expect(error.message).toBe(
      'Connection problem. Check the result before trying again.'
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/files/owner/a.log', {
      signal: undefined,
    })
  })

  it('does not show partial text when the actual stream read fails', async () => {
    const cause = new Error('Connection ended during preview')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
        controller.error(cause)
      },
    })
    serve(new Response(body))
    const pending = loadPreviewText('/api/files/owner/a.log', failed)
    await expect(pending).rejects.toBeInstanceOf(TransportFailure)
    expect((await pending.catch((error) => error)).cause).toBe(cause)
    expect(body.locked).toBe(false)
  })
})
