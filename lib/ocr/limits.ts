import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'

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
 * Spend one recognition from the requester's budget. Returns the seconds to
 * wait when the budget is spent, or null when recognition may start.
 */
export async function takeOcrRequest(requester: string) {
  try {
    await limiter.consume(requester)
    return null
  } catch (error) {
    if (error instanceof RateLimiterRes)
      return Math.max(1, Math.ceil(error.msBeforeNext / 1000))
    throw error
  }
}
