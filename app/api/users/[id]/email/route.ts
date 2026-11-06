import { z } from 'zod'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { lockEmailUser, sendAccountToken } from '@/lib/email/account'
import { getEmailConfig, getEmailConfigForUpdate } from '@/lib/email/config'
import { EmailHttpError } from '@/lib/email/errors'
import { emailRoutes, validateEmailOrigin } from '@/lib/email/http'
import { hasVerifiedEmail, requiresEmailVerification } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import {
  assertAccessibleAdministrator,
  assertCanManageUser,
  requireActorPermission,
} from '@/lib/permissions/server'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/email', emailRoutes)

export const GET = api(async (request, { params }: Context) => {
  await requireSession('users.email')
  const { id } = await params
  const [user, config] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    getEmailConfig(),
  ])
  if (!user) throw new EmailHttpError('Account not found.', 404)
  return {
    verified: hasVerifiedEmail(user, config),
    exempt: user.emailExempt,
    required: requiresEmailVerification(user, config),
    pendingEmail: user.pendingEmail,
  }
})

export const POST = api(async (request, { params }: Context) => {
  const { user: actor } = await requireSession('users.email')
  const { id } = await params
  const { action } = z
    .object({ action: z.enum(['exempt', 'require', 'resend']) })
    .parse(await readJson(request))
  let config = await getEmailConfig()
  validateEmailOrigin(request, config.publicUrl)
  if (!config.enabled) throw new EmailHttpError('Email is disabled.')
  await limitEmailRequest(request, config)
  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    config = await getEmailConfigForUpdate(tx)
    if (!config.enabled) throw new EmailHttpError('Email is disabled.')
    await requireActorPermission(tx, actor.id, 'users.email')
    await assertCanManageUser(tx, actor.id, id)
    const user = await lockEmailUser(tx, id)
    if (action === 'resend') {
      if (
        user.emailVerificationSource !== 'pending_local' ||
        hasVerifiedEmail(user, config)
      )
        throw new EmailHttpError(
          'This user must enroll their recovery address from their own profile.'
        )
      if (user.email) await limitEmailRequest(request, config, user.email)
      await sendAccountToken(tx, user, 'verify', config)
      return
    }
    await tx.user.update({
      where: { id },
      data: { emailExempt: action === 'exempt' },
    })
    await assertAccessibleAdministrator(tx, config)
  })
  return {
    message:
      action === 'resend'
        ? 'Verification email queued.'
        : 'Email verification exemption updated.',
  }
})
