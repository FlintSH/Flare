import type { Prisma } from '@prisma/client'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import {
  assertAccessibleAdministrator,
  assertCanManageUser,
  requireActorPermission,
} from '@/lib/permissions/server'

import { lockEmailUser, sendAccountToken } from './account'
import { getEmailConfig, getEmailConfigForUpdate } from './config'
import { canResendVerification, userEmailStatus } from './eligibility'
import { EmailHttpError } from './errors'
import type { EmailConfig } from './schema'

// An administrator's view of, and actions on, another account's email, for
// the Users page's route and the MCP tools. Callers check the session's
// `users.email` first; the actions check it again under the role lock.

export const USER_EMAIL_ACTIONS = ['exempt', 'require', 'resend'] as const
export type UserEmailAction = (typeof USER_EMAIL_ACTIONS)[number]

/**
 * Counts one request against the caller's email limits, and against the
 * recipient's when it sends to one. The route passes `limitEmailRequest` for
 * its client address; see `limitEmailRequestBy` for another key.
 */
export type EmailRequestLimit = (
  config: EmailConfig,
  recipient?: string
) => Promise<void>

/** Whether the account's address is verified, exempt or required, and whether a link can be resent. */
export async function userEmailStatusFor(userId: string) {
  const [user, config] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    getEmailConfig(),
  ])
  if (!user) throw new EmailHttpError('Account not found.', 404)
  return userEmailStatus(user, config)
}

/**
 * A caller's own last check before an email action, run under the role lock
 * once the service's own checks have passed, in the transaction that acts.
 * Throw to refuse.
 */
export type UserEmailCheck = (tx: Prisma.TransactionClient) => Promise<void>

/**
 * Exempts the account from email verification, requires it again, or resends
 * its verification link. A request is counted once before the transaction,
 * and a resend again with its recipient once the link can be sent.
 */
export async function userEmailAction(
  actorId: string,
  userId: string,
  action: UserEmailAction,
  limit: EmailRequestLimit,
  check?: UserEmailCheck
): Promise<{ message: string }> {
  let config = await getEmailConfig()
  if (!config.enabled) throw new EmailHttpError('Email is disabled.')
  await limit(config)
  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    config = await getEmailConfigForUpdate(tx)
    if (!config.enabled) throw new EmailHttpError('Email is disabled.')
    await requireActorPermission(tx, actorId, 'users.email')
    await assertCanManageUser(tx, actorId, userId)
    await check?.(tx)
    const user = await lockEmailUser(tx, userId)
    if (action === 'resend') {
      if (!canResendVerification(user, config))
        throw new EmailHttpError(
          'This user must enroll their recovery address from their own profile.'
        )
      if (user.email) await limit(config, user.email)
      await sendAccountToken(tx, user, 'verify', config)
      return
    }
    await tx.user.update({
      where: { id: userId },
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
}
