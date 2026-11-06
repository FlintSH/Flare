import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import type { RouteContract } from '@/lib/http/route'

import { getEmailConfig } from './config'
import { EmailHttpError } from './errors'
import { EmailRateLimitError } from './rate-limit'

/** Account email routes. Provider errors, credentials, database details and token values never reach the response. */
export const emailRoutes: RouteContract = {
  translate: (error) => {
    if (error instanceof EmailRateLimitError)
      return new HttpError(429, error.message, {
        headers: { 'Retry-After': '60' },
      })
  },
  failure: {
    status: 400,
    message: 'Unable to complete this email request. Please try again.',
  },
}

export function validateEmailOrigin(req: Request, publicUrl?: string) {
  const origin = req.headers.get('origin')
  const allowed = new Set([new URL(req.url).origin])
  for (const value of [process.env.NEXTAUTH_URL, publicUrl]) {
    if (value) allowed.add(new URL(value).origin)
  }
  if (origin && !allowed.has(origin))
    throw new EmailHttpError('Invalid request origin.', 403)
}

export async function emailSession(req?: Request) {
  // Upload bearer tokens deliberately cannot authorize account/recovery changes.
  const session = await getServerSession(authOptions)
  if (!session?.user) throw new EmailHttpError('Sign in to continue.', 401)
  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) throw new EmailHttpError('Sign in to continue.', 401)
  const config = await getEmailConfig()
  if (req) validateEmailOrigin(req, config.publicUrl)
  return { session, user, config }
}
