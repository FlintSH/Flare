import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import {
  assertRecentIdentity,
  lockEmailUser,
  sendAccountToken,
} from '@/lib/email/account'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { EmailHttpError, emailRoute, emailSession } from '@/lib/email/http'
import { hasVerifiedEmail } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { invalidateEmailTokens } from '@/lib/email/tokens'

export async function POST(req: Request) {
  return emailRoute(async () => {
    const { user, session, config } = await emailSession(req)
    if (!config.enabled || !config.changes.enabled)
      throw new EmailHttpError('Email changes are disabled.')
    const { email, password } = z
      .object({
        email: z.string().trim().email().max(254),
        password: z.string().max(1024).optional(),
      })
      .parse(await req.json())
    await limitEmailRequest(req, config, email)
    await assertRecentIdentity(user, password, session)
    const requiresOldEmail = await prisma.$transaction(async (tx) => {
      const currentConfig = await getEmailConfigForUpdate(tx)
      if (!currentConfig.enabled || !currentConfig.changes.enabled)
        throw new EmailHttpError('Email changes are disabled.')
      const fresh = await lockEmailUser(tx, user.id)
      if (
        fresh.email !== user.email ||
        fresh.password !== user.password ||
        fresh.sessionVersion !== user.sessionVersion
      )
        throw new EmailHttpError('Account changed. Sign in and try again.')
      if (email === fresh.email)
        throw new EmailHttpError('Choose a different email address.')
      if (
        currentConfig.changes.requireOldEmail &&
        !hasVerifiedEmail(fresh, currentConfig)
      )
        throw new EmailHttpError(
          'Your current email must be verified before changing it.'
        )
      const conflict = await tx.user.findFirst({
        where: {
          id: { not: user.id },
          email: { equals: email, mode: 'insensitive' },
        },
      })
      if (conflict)
        throw new EmailHttpError('This email address is unavailable.')
      await invalidateEmailTokens(tx, user.id)
      const pending = await tx.user.update({
        where: { id: user.id },
        data: {
          pendingEmail: email,
          // This records actual approval, independently of the current policy.
          pendingEmailOldConfirmed: false,
        },
      })
      await sendAccountToken(tx, pending, 'change', currentConfig, email)
      if (currentConfig.changes.requireOldEmail)
        await sendAccountToken(tx, pending, 'change_approval', currentConfig)
      return currentConfig.changes.requireOldEmail
    })
    return {
      message: requiresOldEmail
        ? 'Approve the change from your current address, then confirm your new address.'
        : 'Confirm the link sent to your new address to finish.',
    }
  })
}
