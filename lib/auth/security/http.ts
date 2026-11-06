import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { mediaType, readJson } from '@/lib/http/request'
import type { RouteContract } from '@/lib/http/route'

import { SecurityError, securityLimit, validateSecurityOrigin } from './shared'

export const proofSchema = z.object({
  password: z.string().max(256).optional(),
  code: z.string().max(80).optional(),
})
export const passkeyName = z.string().trim().min(1).max(64)
export const challengeResponseSchema = z.object({
  challengeId: z.string().min(20).max(100),
  response: z
    .object({
      id: z.string().min(1).max(2048),
      rawId: z.string(),
      type: z.literal('public-key'),
      response: z.record(z.string(), z.unknown()),
      clientExtensionResults: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
})

/** Account security routes never cache, and explain only their own refusals. */
export const securityRoutes: RouteContract = {
  headers: { 'Cache-Control': 'no-store' },
  invalid: () => new HttpError(400, 'Invalid security request.'),
  failure: {
    status: 400,
    message: 'Unable to complete this security request. Please try again.',
  },
}

export async function securitySession(req: Request, mutation = true) {
  if (mutation) validateSecurityOrigin(req)
  if (req.headers.has('authorization'))
    throw new SecurityError('Use a browser session for account security.', 401)
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) throw new SecurityError('Sign in to continue.', 401)
  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user || user.sessionVersion !== session.user.sessionVersion)
    throw new SecurityError('Sign in again to continue.', 401)
  if (mutation) await securityLimit(`management:${user.id}`)
  return { session, user }
}

/** Security writes are small JSON documents. */
export async function securityBody(req: Request) {
  if (mediaType(req) !== 'application/json')
    throw new SecurityError('Use application/json for security requests.', 415)
  if (!req.body) throw new SecurityError('Invalid security request.')
  try {
    return await readJson(req, { limit: 65536 })
  } catch (error) {
    if (error instanceof HttpError && error.status === 413)
      throw new SecurityError('Security request is too large.', 413)
    throw new SecurityError('Invalid security request.')
  }
}
