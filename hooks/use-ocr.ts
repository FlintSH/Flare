'use client'

import { useState } from 'react'

import {
  RefusedRequest,
  readAnswer,
  refusal,
  retryable,
  sendRequest,
} from '@/lib/client/request'
import type { DecryptedContent } from '@/lib/e2ee/client/file-worker'
import type { OpenedFile } from '@/lib/e2ee/client/files'
import { requestMaintenance } from '@/lib/library/browser-maintenance'
import {
  type EncryptedImage,
  extractEncryptedText,
} from '@/lib/ocr/encrypted-client'

import { useRequestLifetime } from '@/hooks/use-request-lifetime'

export type OcrOutcome =
  | { kind: 'text'; text: string; confidence: number | null }
  /** Recognition continues on the server; asking again later returns the text. */
  | { kind: 'pending'; message: string }
  | { kind: 'error'; message: string; canRetry: boolean }

const FAILED = 'Couldn’t extract text. Please try again.'

type OcrAnswer = {
  success?: boolean
  text?: string
  confidence?: number | null
  error?: string
}

/** Request OCR text and describe the result, including busy and limit responses. */
async function requestOcr(
  url: string,
  signal: AbortSignal
): Promise<OcrOutcome> {
  const response = await sendRequest(url, { signal })
  if (!response.ok) {
    const refused = await refusal(response, FAILED)
    // Access errors need a password or permission, not another attempt.
    return {
      kind: 'error',
      message: refused.message,
      canRetry: retryable(refused),
    }
  }
  const answer = await readAnswer<OcrAnswer>(response, {
    signal,
    whole: true,
  }).catch(() => null)
  if (response.status === 202)
    return {
      kind: 'pending',
      message:
        answer?.error ??
        'Flare is still reading this image. Check again in a moment.',
    }
  if (answer?.success)
    return {
      kind: 'text',
      text: answer.text ?? '',
      confidence: answer.confidence ?? null,
    }
  return { kind: 'error', message: answer?.error ?? FAILED, canRetry: true }
}

/**
 * An encrypted image, which only a browser that has its key can read
 * (docs/e2ee-spec.md, section 9.6.2).
 */
export interface EncryptedOcrSource {
  file: EncryptedImage
  opened: OpenedFile
  /** Only the owner's page stores the text it reads (section 9.6.3). */
  store: boolean
  /** The plaintext, if the page has decrypted the image already. */
  content?: () => DecryptedContent | null
}

/** Reads an encrypted image in this browser, or opens the owner's stored text. */
async function readEncrypted(
  url: string,
  source: EncryptedOcrSource,
  signal: AbortSignal
): Promise<OcrOutcome> {
  try {
    const result = await extractEncryptedText(url, source.file, source.opened, {
      store: source.store,
      content: source.content?.(),
      signal,
    })
    // Tag rules on image text run on the new text in the background.
    if (source.store && result.stored) requestMaintenance('index', 'pending')
    return { kind: 'text', text: result.text, confidence: result.confidence }
  } catch (error) {
    if (signal.aborted) throw error
    return {
      kind: 'error',
      message:
        error instanceof RefusedRequest
          ? error.message
          : 'This browser couldn’t read text from the image. Try again.',
      canRetry: retryable(error),
    }
  }
}

export type OcrDialogState = {
  text: string | null
  confidence: number | null
  notice: string | null
  error: string | null
  canRetry: boolean
}

/**
 * What the dialog shows for an outcome. `null` means the request itself
 * failed, for example on a network error, which can always be retried.
 */
export function ocrDialogState(outcome: OcrOutcome | null): OcrDialogState {
  if (!outcome)
    return {
      text: null,
      confidence: null,
      notice: null,
      error: FAILED,
      canRetry: true,
    }
  return {
    text: outcome.kind === 'text' ? outcome.text : null,
    confidence: outcome.kind === 'text' ? outcome.confidence : null,
    notice: outcome.kind === 'pending' ? outcome.message : null,
    error: outcome.kind === 'error' ? outcome.message : null,
    canRetry:
      outcome.kind === 'pending' ||
      (outcome.kind === 'error' && outcome.canRetry),
  }
}

/**
 * Extracting an image's text from its OCR address: `extract()` asks, and the
 * dialog opens with the answer, including busy, limited, still-running and
 * failed requests with a way to ask again. Nothing happens after the
 * component that asked has gone.
 */
export function useOcr(
  url: string | undefined,
  /** Set for an encrypted image: this browser reads it, not the server. */
  encrypted?: EncryptedOcrSource | null
) {
  const lifetime = useRequestLifetime()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(() => ocrDialogState(null))

  const extract = async () => {
    const { signal } = lifetime.current
    if (!url || signal.aborted) return
    setLoading(true)
    // Reading in the browser takes a few seconds: the dialog shows that.
    if (encrypted) setOpen(true)
    const state = await (
      encrypted
        ? readEncrypted(url, encrypted, signal)
        : requestOcr(url, signal)
    ).then(ocrDialogState, () => ocrDialogState(null))
    if (signal.aborted) return
    setResult(state)
    setOpen(true)
    setLoading(false)
  }

  return {
    loading,
    extract,
    /** The `OcrDialog` props for this image. */
    dialog: {
      isOpen: open,
      onOpenChange: setOpen,
      isLoading: loading,
      ...(encrypted && {
        loadingText: 'Reading the image in your browser…',
        footnote: encrypted.store
          ? 'Read in your browser. The text is saved encrypted, so search finds this image.'
          : 'Read in your browser. The text is not sent to the server.',
      }),
      text: result.text,
      confidence: result.confidence,
      notice: result.notice,
      error: result.error,
      onRetry: result.canRetry ? () => void extract() : undefined,
    },
  }
}
