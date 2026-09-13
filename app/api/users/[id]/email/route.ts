import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { lockEmailUser, sendAccountToken } from '@/lib/email/account'
import { getEmailConfig, resolveEmailConfig } from '@/lib/email/config'
import {
  EmailHttpError,
  emailRoute,
  validateEmailOrigin,
} from '@/lib/email/http'
import {
  hasDurableEmailAccess,
  hasVerifiedEmail,
  requiresEmailVerification,
} from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Context) {
  const { response } = await requireAdmin()
  if (response) return response
  return emailRoute(async () => {
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
}

export async function POST(req: Request, { params }: Context) {
  const { response } = await requireAdmin()
  if (response) return response
  return emailRoute(async () => {
    const { id } = await params
    const { action } = z
      .object({ action: z.enum(['exempt', 'require', 'resend']) })
      .parse(await req.json())
    let config = await getEmailConfig()
    validateEmailOrigin(req, config.publicUrl)
    if (!config.enabled) throw new EmailHttpError('Email is disabled.')
    await limitEmailRequest(req, config)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347202)`
      const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
      if (row) {
        const saved = row.value as { settings?: { email?: unknown } }
        config = resolveEmailConfig(saved.settings?.email).config
      }
      if (!config.enabled) throw new EmailHttpError('Email is disabled.')
      const user = await lockEmailUser(tx, id)
      if (action === 'resend') {
        if (
          user.emailVerificationSource !== 'pending_local' ||
          hasVerifiedEmail(user, config)
        )
          throw new EmailHttpError(
            'This user must enroll their recovery address from their own profile.'
          )
        if (user.email) await limitEmailRequest(req, config, user.email)
        await sendAccountToken(tx, user, 'verify', config)
        return
      }
      if (action === 'require' && user.role === 'ADMIN') {
        const admins = await tx.user.findMany({ where: { role: 'ADMIN' } })
        if (
          !admins.some((admin) =>
            hasDurableEmailAccess(
              admin.id === id ? { ...admin, emailExempt: false } : admin,
              config
            )
          )
        ) {
          throw new EmailHttpError(
            'Verify an administrator email before removing the last administrator exemption.'
          )
        }
      }
      await tx.user.update({
        where: { id },
        data: { emailExempt: action === 'exempt' },
      })
    })
    return {
      message:
        action === 'resend'
          ? 'Verification email queued.'
          : 'Email verification exemption updated.',
    }
  })
}
