import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { ZodError, z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

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
      response: z.record(z.unknown()),
      clientExtensionResults: z.record(z.unknown()),
    })
    .passthrough(),
})

export async function securityRoute(action: () => Promise<unknown>) {
  try {
    const result = await action()
    if (result instanceof Response) return result
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 400
    const message =
      error instanceof SecurityError
        ? error.message
        : error instanceof ZodError
          ? 'Invalid security request.'
          : 'Unable to complete this security request. Please try again.'
    return NextResponse.json(
      { error: message },
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          ...(status === 429 ? { 'Retry-After': '900' } : {}),
        },
      }
    )
  }
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

export async function securityBody(req: Request) {
  if (
    !req.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new SecurityError('Use application/json for security requests.', 415)
  const reader = req.body?.getReader()
  if (!reader) throw new SecurityError('Invalid security request.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 65536) {
      await reader.cancel()
      throw new SecurityError('Security request is too large.', 413)
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new SecurityError('Invalid security request.')
  }
}
