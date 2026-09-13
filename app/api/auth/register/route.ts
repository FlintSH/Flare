import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { lockEmailAddress, sendAccountToken } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'
import { createUser } from '@/lib/users/create-user'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
})

class RegistrationConflictError extends Error {
  constructor() {
    super('User already exists')
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, authLimiter)
  if (limited) return limited

  try {
    const config = await getConfig()
    if (!config.settings.general.registrations.enabled) {
      return new NextResponse(null, { status: 404 })
    }

    const json = await req.json()
    const body = registerSchema.parse(json)
    const emailConfig = await getEmailConfig()
    if (emailConfig.enabled && Buffer.byteLength(body.password, 'utf8') > 72)
      return NextResponse.json(
        { error: 'Password must use at most 72 bytes.' },
        { status: 400 }
      )
    const sendVerification =
      emailConfig.enabled &&
      (emailConfig.verification.mode !== 'off' || emailConfig.recovery.enabled)
    if (sendVerification) await limitEmailRequest(req, emailConfig, body.email)

    const hashedPassword = await hash(body.password, 10)

    const user = await prisma.$transaction(async (tx) => {
      if (emailConfig.enabled) await lockEmailAddress(tx, body.email)
      const exists = emailConfig.enabled
        ? await tx.user.findFirst({
            where: { email: { equals: body.email, mode: 'insensitive' } },
          })
        : await tx.user.findUnique({ where: { email: body.email } })
      if (exists) {
        throw new RegistrationConflictError()
      }

      const created = await createUser(tx, {
        email: body.email,
        name: body.name,
        password: hashedPassword,
        ...(sendVerification
          ? { emailVerificationSource: 'pending_local' }
          : {}),
      })
      if (sendVerification)
        await sendAccountToken(tx, created, 'verify', emailConfig)
      return created
    })

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      nextAction: requiresEmailVerification(user, emailConfig)
        ? 'verify_email'
        : 'sign_in',
    })
  } catch (error) {
    if (error instanceof RegistrationConflictError) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
