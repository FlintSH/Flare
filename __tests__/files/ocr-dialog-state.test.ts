import { describe, expect, it } from 'vitest'

import { ocrDialogState } from '@/components/shared/ocr-dialog'

import { takeOcrRequest } from '@/lib/ocr/limits'

describe('OCR dialog state', () => {
  it('keeps a retry when the request itself fails, such as a lost connection', () => {
    // The dashboard used to leave an open dialog empty, with no retry, here.
    expect(ocrDialogState(null)).toEqual({
      text: null,
      confidence: null,
      notice: null,
      error: 'Couldn’t extract text. Please try again.',
      canRetry: true,
    })
  })

  it('shows text, notices and errors with the right retry choice', () => {
    expect(
      ocrDialogState({ kind: 'text', text: 'Receipt', confidence: 90 })
    ).toMatchObject({ text: 'Receipt', confidence: 90, canRetry: false })
    expect(
      ocrDialogState({ kind: 'pending', message: 'Still reading' })
    ).toMatchObject({ notice: 'Still reading', error: null, canRetry: true })
    expect(
      ocrDialogState({ kind: 'error', message: 'Busy', canRetry: true })
    ).toMatchObject({ error: 'Busy', canRetry: true })
    // Access errors need a password or permission, not another attempt.
    expect(
      ocrDialogState({ kind: 'error', message: 'Password', canRetry: false })
    ).toMatchObject({ error: 'Password', canRetry: false })
  })
})

describe('OCR request budget', () => {
  it('gives a refunded point back to the requester', async () => {
    const requester = 'ip:203.0.113.50'
    const charges = []
    for (let index = 0; index < 20; index++)
      charges.push(await takeOcrRequest(requester))
    expect(charges.every((charge) => 'refund' in charge)).toBe(true)

    // The queue refunds only successful charges, before any refusal.
    const first = charges[0]
    if (!('refund' in first)) throw new Error('expected a charge')
    await first.refund()
    expect(await takeOcrRequest(requester)).toHaveProperty('refund')
    expect(await takeOcrRequest(requester)).toHaveProperty('retryAfterSeconds')
  })
})
