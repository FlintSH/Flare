import NextAuth from 'next-auth/next'

import { authOptions } from '@/lib/auth'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'

const handler = NextAuth(authOptions)

export { handler as GET }

export async function POST(req: Request, ctx: Record<string, unknown>) {
  const limited = await rateLimit(req, authLimiter)
  if (limited) return limited
  return handler(
    req as unknown as Parameters<typeof handler>[0],
    ctx as unknown as Parameters<typeof handler>[1]
  )
}
