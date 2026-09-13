import { prisma } from '@/lib/database/prisma'
import { lockEmailUser, sendAccountToken } from '@/lib/email/account'
import { EmailHttpError, emailRoute, emailSession } from '@/lib/email/http'
import { hasVerifiedEmail } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'

export async function POST(req: Request) {
  return emailRoute(async () => {
    const { user, config } = await emailSession(req)
    if (!config.enabled || !user.email)
      throw new EmailHttpError('Email is disabled.')
    await limitEmailRequest(req, config, user.email)
    await prisma.$transaction(async (tx) => {
      const fresh = await lockEmailUser(tx, user.id)
      if (hasVerifiedEmail(fresh, config)) return
      if (fresh.emailVerificationSource !== 'pending_local')
        throw new EmailHttpError(
          'Confirm your current password to enroll your recovery email first.'
        )
      await sendAccountToken(tx, fresh, 'verify', config)
    })
    return { message: 'A verification link was sent to your email address.' }
  })
}
