import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { emailAdminAccess, emailSettingsError } from '@/lib/email/admin'
import { getEmailConfig, prepareEmailConfig } from '@/lib/email/config'
import { hasVerifiedEmail } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'

async function impact(config: EmailConfig) {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      emailVerifiedFor: true,
      emailVerified: true,
      emailVerificationSource: true,
      emailExempt: true,
    },
  })
  const unverified = users.filter((user) => !hasVerifiedEmail(user, config))
  return NextResponse.json({
    data: {
      unverifiedUsers: unverified.length,
      affectedUsers: unverified.filter((user) => !user.emailExempt).length,
    },
  })
}

export async function GET(request: Request) {
  const denied = await emailAdminAccess(request)
  if (denied) return denied
  try {
    return await impact(await getEmailConfig())
  } catch (error) {
    return emailSettingsError(error)
  }
}

export async function POST(request: Request) {
  const denied = await emailAdminAccess(request)
  if (denied) return denied
  try {
    const body = await request.json()
    return await impact(
      (await prepareEmailConfig(body.config, body.clearPassword === true))
        .effective
    )
  } catch (error) {
    return emailSettingsError(error)
  }
}
