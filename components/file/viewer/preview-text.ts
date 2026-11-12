import { useEffect, useState } from 'react'

import { readPreviewBytes } from '@/lib/client/preview-bytes'

/** The most text, code or CSV a share page loads to preview a file. */
export const PREVIEW_TEXT_BYTES = 1024 * 1024

const TOO_LARGE = 'This file is too large to preview.'

export type PreviewText =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'failed'; message: string }

/**
 * A file's text, read no further than PREVIEW_TEXT_BYTES even when the
 * response doesn't state its length. `failed` words a request that didn't
 * succeed, with its status when there is one.
 */
export async function loadPreviewText(
  url: string,
  failed: (status?: number) => string,
  signal?: AbortSignal
) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(failed(response.status))
  if (Number(response.headers.get('content-length')) > PREVIEW_TEXT_BYTES) {
    void response.body?.cancel()
    throw new Error(TOO_LARGE)
  }
  const { bytes, truncated } = await readPreviewBytes(
    response,
    PREVIEW_TEXT_BYTES
  )
  if (truncated) throw new Error(TOO_LARGE)
  return decodeText(bytes)
}

/**
 * A text file's bytes as text. UTF-8, except for a file that starts with a
 * UTF-16 byte order mark, as Windows tools write when asked for "Unicode":
 * read as UTF-8, that text is a NUL after every character.
 */
export function decodeText(bytes: Uint8Array) {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}

/**
 * Whether decoded text is really binary data: text files don't hold NUL
 * characters, and almost every binary format does within its first bytes.
 */
export function looksBinary(text: string) {
  return text.slice(0, 8192).includes('\u0000')
}

/** Loads a preview's text; pass a `failed` that keeps its identity. */
export function usePreviewText(
  url: string,
  failed: (status?: number) => string
): PreviewText {
  const [result, setResult] = useState<{ url: string; preview: PreviewText }>()

  useEffect(() => {
    const controller = new AbortController()
    const settle = (preview: PreviewText) => {
      if (!controller.signal.aborted) setResult({ url, preview })
    }
    loadPreviewText(url, failed, controller.signal).then(
      (text) => settle({ status: 'ready', text }),
      (error: unknown) =>
        settle({
          status: 'failed',
          message: error instanceof Error ? error.message : failed(),
        })
    )
    return () => controller.abort()
  }, [url, failed])

  return result?.url === url ? result.preview : { status: 'loading' }
}
