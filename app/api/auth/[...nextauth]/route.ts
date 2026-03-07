import NextAuth from 'next-auth/next'

import { authOptions } from '@/lib/auth'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'

const nextAuth = NextAuth(authOptions)

export { nextAuth as GET }

export async function POST(...args: Parameters<typeof nextAuth>) {
  const limited = await rateLimit(args[0] as unknown as Request, authLimiter)
  if (limited) return limited
  return nextAuth(...args)
}
