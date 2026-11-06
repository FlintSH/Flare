import { useEffect, useState } from 'react'

import { readPreviewBytes } from '@/components/archives/archive-utils'

/** The most text, code or CSV a share page loads to preview a file. */
export const PREVIEW_TEXT_BYTES = 1024 * 1024

const TOO_LARGE =
  'This file is too large to preview. Download it to view all its data.'

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
  return new TextDecoder().decode(bytes)
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
