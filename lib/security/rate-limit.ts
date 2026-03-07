import { RateLimiterMemory } from 'rate-limiter-flexible'

// per-process, resets on restart. TODO (maybe eventually): swap to Redis if folks are running multiple containers

export const authLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
  keyPrefix: 'auth',
})

export const setupLimiter = new RateLimiterMemory({
  points: 3,
  duration: 60,
  keyPrefix: 'setup',
})

export const uploadLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
  keyPrefix: 'upload',
})

export const generalLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60,
  keyPrefix: 'general',
})

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = req.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }
  return '127.0.0.1'
}

// returns a 429 Response when exceeded, null when ok
export async function rateLimit(
  req: Request,
  limiter: RateLimiterMemory
): Promise<Response | null> {
  const ip = getClientIp(req)
  try {
    await limiter.consume(ip)
    return null
  } catch {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
      },
    })
  }
}
