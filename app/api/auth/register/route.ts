import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { z } from 'zod'

import { recordAudit } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import { lockEmailAddress, lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { sendAccountToken } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoutes } from '@/lib/email/http'
import { requiresEmailVerification } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { InviteError, redeemInvite } from '@/lib/invites/service'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'
import { createUser } from '@/lib/users/create-user'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  invite: z.string().max(200).optional(),
})

const api = routes('/api/auth/register', {
  translate: (error) => {
    if (error instanceof InviteError)
      return new HttpError(400, error.message, {
        body: { code: `invite_${error.reason}` },
      })
    // The verification email is rate limited like the email routes.
    return emailRoutes.translate?.(error)
  },
  failure: { message: 'Internal server error' },
})

export const POST = api(async (request) => {
  const limited = await rateLimit(request, authLimiter)
  if (limited) return limited

  const config = await getConfig()
  const json = await readJson(request).catch((error: unknown) => {
    // Unreadable JSON is answered after the registration check below.
    if (error instanceof HttpError && error.status === 413) throw error
    return null
  })
  const invite =
    json && typeof json === 'object' && 'invite' in json
      ? json.invite
      : undefined
  // An invite is the only way to create an account while registration is closed.
  if (!config.settings.general.registrations.enabled && invite === undefined) {
    return new NextResponse(null, { status: 404 })
  }
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')
  const body = registerSchema.parse(json)
  const emailConfig = await getEmailConfig()
  if (emailConfig.enabled && Buffer.byteLength(body.password, 'utf8') > 72)
    throw new HttpError(400, 'Password must use at most 72 bytes.')
  const sendVerification =
    emailConfig.enabled &&
    (emailConfig.verification.mode !== 'off' || emailConfig.recovery.enabled)
  if (sendVerification)
    await limitEmailRequest(request, emailConfig, body.email)

  const hashedPassword = await hash(body.password, 10)

  const { user, redeemed } = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    // Redeemed in the same transaction: a rejected sign-up never spends a use.
    const redeemed =
      body.invite === undefined ? null : await redeemInvite(tx, body.invite)
    if (emailConfig.enabled) await lockEmailAddress(tx, body.email)
    const exists = emailConfig.enabled
      ? await tx.user.findFirst({
          where: { email: { equals: body.email, mode: 'insensitive' } },
        })
      : await tx.user.findUnique({ where: { email: body.email } })
    if (exists) throw new HttpError(400, 'User already exists')

    const created = await createUser(tx, {
      email: body.email,
      name: body.name,
      password: hashedPassword,
      roleIds: redeemed?.roleIds,
      inviteId: redeemed?.id,
      ...(sendVerification ? { emailVerificationSource: 'pending_local' } : {}),
    })
    if (sendVerification)
      await sendAccountToken(tx, created, 'verify', emailConfig)
    return { user: created, redeemed }
  })
  if (redeemed)
    await recordAudit({
      action: 'invite.redeem',
      category: 'invites',
      targetType: 'invite',
      targetId: redeemed.id,
      targetName: redeemed.note || null,
      details: {
        accountId: user.id,
        accountName: user.name,
        roleIds: redeemed.roleIds,
      },
    })

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    nextAction: requiresEmailVerification(user, emailConfig)
      ? 'verify_email'
      : 'sign_in',
  }
})
