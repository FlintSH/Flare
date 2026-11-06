'use client'

import { useState } from 'react'

import {
  readAnswer,
  refusal,
  retryable,
  sendRequest,
} from '@/lib/client/request'

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
export function useOcr(url: string | undefined) {
  const lifetime = useRequestLifetime()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(() => ocrDialogState(null))

  const extract = async () => {
    const { signal } = lifetime.current
    if (!url || signal.aborted) return
    setLoading(true)
    const state = await requestOcr(url, signal).then(ocrDialogState, () =>
      ocrDialogState(null)
    )
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
      text: result.text,
      confidence: result.confidence,
      notice: result.notice,
      error: result.error,
      onRetry: result.canRetry ? () => void extract() : undefined,
    },
  }
}
