import { Prisma, type User } from '@prisma/client'
import type { Session } from 'next-auth'

import { assertFreshIdentity } from '@/lib/auth/security/service'
import { getConfig, readConfig } from '@/lib/config'
import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { changeCredentials, hashAccountPassword } from '@/lib/users/credentials'
import { claimEmail, findAccountByEmail } from '@/lib/users/email-claim'

import { getEmailConfigForUpdate } from './config'
import {
  canResendVerification,
  currentAddressMustVerify,
  emailChangesEnabled,
  passwordRecoveryAvailable,
} from './eligibility'
import { EmailHttpError } from './errors'
import {
  EMAIL_CHANGE_PURPOSES,
  EMAIL_LINKS,
  type EmailTokenPurpose,
  emailLinkAvailable,
} from './links'
import { MailLimitError, enqueueMail } from './outbox'
import { canRecoverPassword, hasVerifiedEmail } from './policy'
import type { EmailConfig } from './schema'
import { renderAccountEmail } from './templates'
import {
  consumeEmailToken,
  invalidateEmailTokens,
  issueEmailToken,
} from './tokens'

/** A signed-in account asking for an email action, as `emailSession` reads it. */
export interface EmailAccount {
  user: User
  session: Session
  config: EmailConfig
}

export async function lockEmailUser(tx: Prisma.TransactionClient, id: string) {
  await lockUserRow(tx, id)
  const user = await tx.user.findUnique({ where: { id } })
  if (!user) throw new EmailHttpError('Account not found.')
  return user
}

export async function sendAccountToken(
  tx: Prisma.TransactionClient,
  user: User,
  purpose: EmailTokenPurpose,
  config: EmailConfig,
  email = user.email
) {
  if (!config.enabled || !email)
    throw new EmailHttpError('Email is unavailable.')
  const link = EMAIL_LINKS[purpose]
  const expiresAt = new Date(Date.now() + link.lifetime(config))
  const { token, record } = await issueEmailToken(tx, {
    userId: user.id,
    email,
    purpose,
    expiresAt,
  })
  const url = new URL(link.page, config.publicUrl)
  url.searchParams.set('token', token)
  const message = renderAccountEmail(config, {
    kind: purpose,
    recipient: email,
    username: user.name || undefined,
    oldEmail: user.email || undefined,
    newEmail: user.pendingEmail || undefined,
    url: url.toString(),
  })
  await enqueueMail(
    tx,
    {
      userId: user.id,
      tokenId: record.id,
      purpose,
      recipient: email,
      ...message,
      expiresAt,
    },
    config
  )
}

export async function requestPasswordReset(email: string, config: EmailConfig) {
  if (!(await isPasswordRecoveryAvailable(config))) return
  // Case-insensitive collisions are ambiguous; never merge or choose one legacy account.
  const match = await findAccountByEmail(prisma, email, {
    id: true,
    password: true,
    email: true,
    emailVerified: true,
    emailVerifiedFor: true,
    emailVerificationSource: true,
    emailExempt: true,
    createdAt: true,
  })
  if (!match || !canRecoverPassword(match, config)) return
  await prisma.$transaction(async (tx) => {
    config = await getEmailConfigForUpdate(tx)
    if (!(await isPasswordRecoveryAvailable(config, tx))) return
    const user = await lockEmailUser(tx, match.id)
    if (!canRecoverPassword(user, config)) return
    await sendAccountToken(tx, user, 'reset', config)
  })
}

export async function resetPassword(
  token: string,
  password: string,
  config: EmailConfig
) {
  if (!(await isPasswordRecoveryAvailable(config)))
    throw new EmailHttpError('Password recovery is disabled.')
  const passwordHash = await hashAccountPassword(password)
  await prisma.$transaction(async (tx) => {
    config = await getEmailConfigForUpdate(tx)
    if (!(await isPasswordRecoveryAvailable(config, tx)))
      throw new EmailHttpError('Password recovery is disabled.')
    const record = await consumeEmailToken(tx, token, ['reset'])
    const user = await lockEmailUser(tx, record.userId)
    if (!canRecoverPassword(user, config) || user.email !== record.email)
      throw new EmailHttpError('This email link is invalid or expired.')
    await tx.user.update({
      where: { id: user.id },
      data: await changeCredentials(tx, user.id, {
        password: passwordHash,
        rotateUploadToken: config.recovery.rotateUploadToken,
      }),
    })
    const message = renderAccountEmail(config, {
      kind: 'password_changed',
      recipient: record.email,
      username: user.name || undefined,
    })
    try {
      await enqueueMail(
        tx,
        {
          userId: user.id,
          purpose: 'password_changed',
          recipient: record.email,
          ...message,
        },
        config
      )
    } catch (error) {
      if (!(error instanceof MailLimitError)) throw error
    }
  })
}

export async function isPasswordRecoveryAvailable(
  config: EmailConfig,
  tx?: Prisma.TransactionClient
) {
  if (!emailLinkAvailable(config, 'reset')) return false
  // When changing account state, read SSO policy under the same settings lock.
  const fullConfig = tx ? await readConfig(tx) : await getConfig()
  return passwordRecoveryAvailable(config, fullConfig.settings.general.oidc)
}

export async function confirmEmailToken(token: string, config: EmailConfig) {
  if (!config.enabled) throw new EmailHttpError('Email is disabled.')
  return prisma.$transaction(async (tx) => {
    // Policy changes and account mutations share a lock; never approve against
    // a request snapshot captured before an administrator tightened the policy.
    config = await getEmailConfigForUpdate(tx)
    if (!config.enabled) throw new EmailHttpError('Email is disabled.')
    const record = await consumeEmailToken(tx, token, [
      'verify',
      ...EMAIL_CHANGE_PURPOSES,
    ])
    const user = await lockEmailUser(tx, record.userId)
    if (record.purpose === 'verify') {
      if (user.email !== record.email)
        throw new EmailHttpError('This email link is invalid or expired.')
      await tx.user.update({
        where: { id: user.id },
        data: {
          emailVerified: new Date(),
          emailVerifiedFor: user.email,
          emailVerificationSource: 'email',
        },
      })
      return 'Your email address is verified.'
    }
    if (!emailChangesEnabled(config) || !user.pendingEmail)
      throw new EmailHttpError('This email change is no longer available.')
    if (record.purpose === 'change_approval') {
      if (record.email !== user.email)
        throw new EmailHttpError('This email link is invalid or expired.')
      await tx.user.update({
        where: { id: user.id },
        data: { pendingEmailOldConfirmed: true },
      })
      return 'Email change approved. Confirm the link sent to your new address to finish.'
    }
    if (record.email !== user.pendingEmail)
      throw new EmailHttpError('This email link is invalid or expired.')
    if (config.changes.requireOldEmail && !user.pendingEmailOldConfirmed) {
      const approval = await tx.emailToken.findFirst({
        where: {
          userId: user.id,
          purpose: 'change_approval',
          email: user.email!,
          createdAt: { gte: record.createdAt },
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
      if (!approval)
        throw new EmailHttpError(
          'This email change requires approval from your current address. Start the email change again to request an approval link.'
        )
      throw new EmailHttpError(
        'Approve the change using the link sent to your current address first.'
      )
    }
    if (
      !(await claimEmail(tx, record.email, {
        accountId: user.id,
        anyCase: true,
      }))
    )
      throw new EmailHttpError('This email address is unavailable.')
    const oldEmail = user.email
    await tx.user.update({
      where: { id: user.id },
      data: await changeCredentials(tx, user.id, {
        email: { address: record.email, verified: true },
      }),
    })
    if (oldEmail && hasVerifiedEmail(user, config)) {
      const message = renderAccountEmail(config, {
        kind: 'email_changed',
        recipient: oldEmail,
        username: user.name || undefined,
        oldEmail,
      })
      try {
        await enqueueMail(
          tx,
          {
            userId: user.id,
            purpose: 'email_changed',
            recipient: oldEmail,
            ...message,
          },
          config
        )
      } catch (error) {
        if (!(error instanceof MailLimitError)) throw error
      }
    }
    return 'Your email address was changed. Sign in with your new address.'
  })
}

export function requireEmailAddress(user: User, config: EmailConfig) {
  if (!config.enabled || !user.email)
    throw new EmailHttpError('Email is disabled.')
  return user.email
}

export function assertEmailChangesEnabled(config: EmailConfig) {
  if (!emailChangesEnabled(config))
    throw new EmailHttpError('Email changes are disabled.')
}

async function lockConfirmedUser(
  tx: Prisma.TransactionClient,
  { user, session }: EmailAccount,
  password: string | undefined
) {
  const fresh = await lockEmailUser(tx, user.id)
  if (fresh.passkeyRequired)
    await assertFreshIdentity(fresh, { password }, session, {
      secondFactor: false,
    })
  return fresh
}

function assertAccountUnchanged(fresh: User, user: User) {
  if (
    fresh.email !== user.email ||
    fresh.password !== user.password ||
    fresh.sessionVersion !== user.sessionVersion
  )
    throw new EmailHttpError('Account changed. Sign in and try again.')
}

/** Starts verifying the account's current address, after it proves its identity. */
export async function enrollEmail(
  account: EmailAccount,
  password: string | undefined
) {
  const { user, session, config } = account
  await assertFreshIdentity(user, { password }, session, {
    secondFactor: false,
  })
  await prisma.$transaction(async (tx) => {
    const fresh = await lockConfirmedUser(tx, account, password)
    if (hasVerifiedEmail(fresh, config)) return
    assertAccountUnchanged(fresh, user)
    await tx.user.update({
      where: { id: user.id },
      data: { emailVerificationSource: 'pending_local' },
    })
    await sendAccountToken(tx, fresh, 'verify', config)
  })
  return 'A verification link was sent to your email address.'
}

export async function resendVerification({ user, config }: EmailAccount) {
  await prisma.$transaction(async (tx) => {
    const fresh = await lockEmailUser(tx, user.id)
    if (hasVerifiedEmail(fresh, config)) return
    if (!canResendVerification(fresh, config))
      throw new EmailHttpError(
        'Confirm your current password to enroll your recovery email first.'
      )
    await sendAccountToken(tx, fresh, 'verify', config)
  })
  return 'A verification link was sent to your email address.'
}

/**
 * Asks to replace the account's address with `email`, after it proves its
 * identity: the new address confirms the change and, when the settings ask
 * for it, the current address approves it.
 */
export async function requestEmailChange(
  account: EmailAccount,
  email: string,
  password: string | undefined
) {
  const { user, session } = account
  await assertFreshIdentity(user, { password }, session, {
    secondFactor: false,
  })
  const requiresOldEmail = await prisma.$transaction(async (tx) => {
    const config = await getEmailConfigForUpdate(tx)
    assertEmailChangesEnabled(config)
    const fresh = await lockConfirmedUser(tx, account, password)
    assertAccountUnchanged(fresh, user)
    if (email === fresh.email)
      throw new EmailHttpError('Choose a different email address.')
    if (currentAddressMustVerify(fresh, config))
      throw new EmailHttpError(
        'Your current email must be verified before changing it.'
      )
    if (!(await claimEmail(tx, email, { accountId: user.id, anyCase: true })))
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
    await sendAccountToken(tx, pending, 'change', config, email)
    if (config.changes.requireOldEmail)
      await sendAccountToken(tx, pending, 'change_approval', config)
    return config.changes.requireOldEmail
  })
  return requiresOldEmail
    ? 'Approve the change from your current address, then confirm your new address.'
    : 'Confirm the link sent to your new address to finish.'
}

/** Drops a pending address change and voids its links. */
export async function cancelEmailChange(userId: string) {
  await prisma.$transaction(async (tx) => {
    await lockEmailUser(tx, userId)
    await tx.user.update({
      where: { id: userId },
      data: { pendingEmail: null, pendingEmailOldConfirmed: false },
    })
    await tx.emailToken.updateMany({
      where: {
        userId,
        purpose: { in: [...EMAIL_CHANGE_PURPOSES] },
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    })
  })
  return 'The pending email change was canceled.'
}
