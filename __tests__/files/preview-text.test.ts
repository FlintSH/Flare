import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decodeText,
  loadPreviewText,
  looksBinary,
} from '@/components/file/viewer/preview-text'
import { parseTable } from '@/components/file/viewer/viewers/csv-viewer'

// The preview limit the handbook states (guide/sharing.md).
const MIB = 1024 * 1024
const failed = (status?: number) => `Failed: ${status}`
const TOO_LARGE = 'This file is too large to preview.'

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
    controller.abort()
    await expect(
      loadPreviewText('/api/files/owner/a.log', failed, controller.signal)
    ).rejects.toThrow()
  })
})

// A file named like text can hold anything: a browser gives an unknown
// extension no type, and the page then goes by the name.
describe('looksBinary', () => {
  it('lets text through, in any script', () => {
    expect(looksBinary('')).toBe(false)
    expect(looksBinary('#!/bin/sh\necho "olá, 世界"\n')).toBe(false)
    expect(looksBinary('col\tcol\r\n1\t2\r\n')).toBe(false)
  })

  it('recognizes binary data by a NUL near the start', () => {
    expect(looksBinary('\u007fELF\u0001\u0001\u0000\u0000')).toBe(true)
    expect(looksBinary(`PK\u0003\u0004${'\u0000'.repeat(8)}`)).toBe(true)
  })

  it('reads only the start of a long file', () => {
    expect(looksBinary(`${'a'.repeat(8192)}\u0000`)).toBe(false)
    expect(looksBinary(`${'a'.repeat(8191)}\u0000`)).toBe(true)
  })
})

describe('decodeText', () => {
  const utf16 = (text: string, littleEndian: boolean) => {
    const bytes = new Uint8Array(2 + text.length * 2)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 0xfeff, littleEndian)
    for (let index = 0; index < text.length; index++)
      view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian)
    return bytes
  }

  it('reads UTF-8, with or without a byte order mark', () => {
    expect(decodeText(new TextEncoder().encode('olá, 世界'))).toBe('olá, 世界')
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe(
      'hi'
    )
    expect(decodeText(new Uint8Array())).toBe('')
  })

  // Notepad's "Unicode" and PowerShell's default redirect write UTF-16. Read
  // as UTF-8 it is a NUL after every character, which looks binary.
  it('reads UTF-16 text by its byte order mark', () => {
    for (const littleEndian of [true, false]) {
      const text = decodeText(utf16('Olá\r\nlog', littleEndian))
      expect(text, String(littleEndian)).toBe('Olá\r\nlog')
      expect(looksBinary(text)).toBe(false)
    }
  })
})

describe('parseTable', () => {
  it('reads comma-separated and semicolon-separated files', () => {
    expect(parseTable('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseTable('a;b\n1,5;2\n')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ])
  })

  // Guessing picks the comma here and splits each row into three cells.
  it('splits a tab-separated file on its tabs, not on the commas in its cells', () => {
    const tsv = 'Last, First\tCity, Country\nRivera, Alex\tPorto, Portugal\n'
    expect(parseTable(tsv, '\t')).toEqual([
      ['Last, First', 'City, Country'],
      ['Rivera, Alex', 'Porto, Portugal'],
    ])
    expect(parseTable(tsv)[0]).toHaveLength(3)
  })

  it('skips blank lines', () => {
    expect(parseTable('a\tb\n\n1\t2\n', '\t')).toHaveLength(2)
    expect(parseTable('')).toEqual([])
  })
})
