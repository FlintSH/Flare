import { RateLimiterMemory } from 'rate-limiter-flexible'

import { clientIp } from './client-ip'

// per-process, resets on restart. TODO (maybe eventually): swap to Redis if folks are running multiple containers

// Next can compile route handlers into separate bundles, each with its own
// copy of a module, so the limiters live on globalThis instead.
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const limiters = (processState[Symbol.for('flare.security.rate-limits')] ??=
  new Map()) as Map<string, RateLimiterMemory>

/**
 * The limiter called `name`, allowing `points` requests per client address
 * every `seconds`. Each process has one, whichever route module asks, so
 * routes that name the same limit spend one budget.
 */
export function requestLimit(name: string, points: number, seconds = 60) {
  let limiter = limiters.get(name)
  if (!limiter) {
    limiter = new RateLimiterMemory({
      points,
      duration: seconds,
      keyPrefix: name,
    })
    limiters.set(name, limiter)
  }
  return limiter
}

export const authLimiter = requestLimit('auth', 5)
export const setupLimiter = requestLimit('setup', 3)
export const uploadLimiter = requestLimit('upload', 30)
export const generalLimiter = requestLimit('general', 60)

/**
 * The address a per-process limit counts a request under. Requests that
 * carry no usable address all count as one client, the loopback address.
 */
function countedAddress(request: Request) {
  return clientIp(request.headers) ?? '127.0.0.1'
}

/**
 * `ip:` and the address a per-process limit counts this request under, for
 * limits that also count accounts under `user:` keys.
 */
export function requesterKey(request: Request) {
  return `ip:${countedAddress(request)}`
}

/** A 429 response once this client has spent the limit, otherwise null. */
export async function rateLimit(
  request: Request,
  limiter: RateLimiterMemory
): Promise<Response | null> {
  try {
    await limiter.consume(countedAddress(request))
    return null
  } catch {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        // A window opens with the client's first request, so after a whole
        // window the client has its full budget again.
        'Retry-After': String(limiter.duration),
      },
    })
  }
}
