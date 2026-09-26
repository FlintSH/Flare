import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { ZodError } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { PermissionError } from '@/lib/permissions/server'

import { getEmailConfig } from './config'
import { EmailRateLimitError } from './rate-limit'

export class EmailHttpError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

export async function emailRoute(action: () => Promise<unknown>) {
  try {
    return NextResponse.json(await action())
  } catch (error) {
    if (error instanceof EmailHttpError || error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    if (error instanceof EmailRateLimitError)
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    // Never expose provider errors, credentials, database details, or token values.
    const safe =
      error instanceof Error &&
      /^(This email|Confirm your current|Sign in again|Account not found|Email is |Password recovery is |Approve the change|Your current email)/.test(
        error.message
      )
    return NextResponse.json(
      {
        error: safe
          ? (error as Error).message
          : 'Unable to complete this email request. Please try again.',
      },
      { status: 400 }
    )
  }
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
