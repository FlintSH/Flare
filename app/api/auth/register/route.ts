import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { z } from 'zod'

import { recordAudit, withAuditRoute } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { lockEmailAddress, sendAccountToken } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { InviteError, redeemInvite } from '@/lib/invites/service'
import { lockRoleChanges } from '@/lib/permissions/server'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'
import { createUser } from '@/lib/users/create-user'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  invite: z.string().max(200).optional(),
})

class RegistrationConflictError extends Error {
  constructor() {
    super('User already exists')
  }
}

async function handlePOST(req: Request) {
  const limited = await rateLimit(req, authLimiter)
  if (limited) return limited

  try {
    const config = await getConfig()
    const json = await req.json().catch(() => null)
    const invite =
      json && typeof json === 'object' && 'invite' in json
        ? json.invite
        : undefined
    // An invite is the only way to create an account while registration is closed.
    if (
      !config.settings.general.registrations.enabled &&
      invite === undefined
    ) {
      return new NextResponse(null, { status: 404 })
    }
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return NextResponse.json(
        { error: 'Provide a JSON object' },
        { status: 400 }
      )
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
      if (exists) {
        throw new RegistrationConflictError()
      }

      const created = await createUser(tx, {
        email: body.email,
        name: body.name,
        password: hashedPassword,
        roleIds: redeemed?.roleIds,
        inviteId: redeemed?.id,
        ...(sendVerification
          ? { emailVerificationSource: 'pending_local' }
          : {}),
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
    if (error instanceof InviteError)
      return NextResponse.json(
        { error: error.message, code: `invite_${error.reason}` },
        { status: 400 }
      )
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

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/register',
  })(req)
}
