import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import {
  assertRecentIdentity,
  lockEmailUser,
  sendAccountToken,
} from '@/lib/email/account'
import { EmailHttpError } from '@/lib/email/errors'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { hasVerifiedEmail } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/enroll', emailRoutes)

export const POST = api(async (request) => {
  const { user, session, config } = await emailSession(request)
  if (!config.enabled || !user.email)
    throw new EmailHttpError('Email is disabled.')
  const { password } = z
    .object({ password: z.string().max(1024).optional() })
    .parse(await readJson(request))
  await limitEmailRequest(request, config, user.email)
  await assertRecentIdentity(user, password, session)
  await prisma.$transaction(async (tx) => {
    const fresh = await lockEmailUser(tx, user.id)
    if (fresh.passkeyRequired)
      await assertRecentIdentity(fresh, password, session)
    if (hasVerifiedEmail(fresh, config)) return
    if (
      fresh.email !== user.email ||
      fresh.password !== user.password ||
      fresh.sessionVersion !== user.sessionVersion
    )
      throw new EmailHttpError('Account changed. Sign in and try again.')
    await tx.user.update({
      where: { id: user.id },
      data: { emailVerificationSource: 'pending_local' },
    })
    await sendAccountToken(tx, fresh, 'verify', config)
  })
  return { message: 'A verification link was sent to your email address.' }
})
