import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'

import type { OCRAdmission } from './queue'

/**
 * Recognitions one requester can start per window. Cached results and joining
 * work already queued for a file are free. Per process, like Flare's other
 * in-memory limits; a restart clears it.
 */
export const OCR_REQUESTS_PER_WINDOW = 20
export const OCR_REQUEST_WINDOW_SECONDS = 10 * 60

const limiter = new RateLimiterMemory({
  points: OCR_REQUESTS_PER_WINDOW,
  duration: OCR_REQUEST_WINDOW_SECONDS,
  keyPrefix: 'ocr-request',
})

/**
 * Spend one recognition from the requester's budget. Returns how long to wait
 * when the budget is spent, or a way to give the point back when the request
 * ends up joining work it didn't start.
 */
export async function takeOcrRequest(requester: string): Promise<OCRAdmission> {
  try {
    await limiter.consume(requester)
    return { refund: async () => void (await limiter.reward(requester)) }
  } catch (error) {
    if (error instanceof RateLimiterRes)
      return {
        retryAfterSeconds: Math.max(1, Math.ceil(error.msBeforeNext / 1000)),
      }
    throw error
  }
}
