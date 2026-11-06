import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PREVIEW_TEXT_BYTES,
  loadPreviewText,
} from '@/components/file/viewer/preview-text'

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

  it('caps text, code and CSV at 1 MiB', () => {
    expect(PREVIEW_TEXT_BYTES).toBe(1024 * 1024)
  })

  it('previews a file of exactly the cap', async () => {
    const { body } = stream(16, PREVIEW_TEXT_BYTES / 16)
    serve(new Response(body))
    const text = await loadPreviewText('/api/files/owner/a.log', failed)
    expect(text).toHaveLength(PREVIEW_TEXT_BYTES)
  })

  it('refuses a file whose stated length is over the cap', async () => {
    serve(
      new Response('a', {
        headers: { 'content-length': String(PREVIEW_TEXT_BYTES + 1) },
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

  it('passes the signal to fetch', async () => {
    const fetch = serve(new Response('x'))
    const controller = new AbortController()
    await loadPreviewText('/api/files/owner/a.log', failed, controller.signal)
    expect(fetch).toHaveBeenCalledWith('/api/files/owner/a.log', {
      signal: controller.signal,
    })
  })
})
