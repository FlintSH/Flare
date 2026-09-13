import { Prisma, type User } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import type { Session } from 'next-auth'
import { randomUUID } from 'node:crypto'

import { DEFAULT_CONFIG, configSchema, getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import { getEmailConfigForUpdate } from './config'
import { MailLimitError, enqueueMail } from './outbox'
import { canRecoverPassword, hasVerifiedEmail } from './policy'
import type { EmailConfig } from './schema'
import { renderAccountEmail } from './templates'
import {
  type EmailTokenPurpose,
  consumeEmailToken,
  invalidateEmailTokens,
  issueEmailToken,
} from './tokens'

/** Serialize mailbox claims without rewriting or merging legacy addresses. */
export async function lockEmailAddress(
  tx: Prisma.TransactionClient,
  email: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(lower(${email.trim()}), 71041))`
}

export async function lockEmailUser(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`
  const user = await tx.user.findUnique({ where: { id } })
  if (!user) throw new Error('Account not found.')
  return user
}

export async function assertRecentIdentity(
  user: User,
  password: string | undefined,
  session: Session
) {
  if (user.password) {
    if (!password || !(await compare(password, user.password)))
      throw new Error('Confirm your current password to continue.')
    return
  }
  if (
    !user.oidcSubject ||
    session.user.authMethod !== 'oidc' ||
    !session.user.authTime ||
    Date.now() - session.user.authTime > 5 * 60 * 1000
  ) {
    throw new Error(
      'Sign in again with SSO, then try again within five minutes.'
    )
  }
}

export async function sendAccountToken(
  tx: Prisma.TransactionClient,
  user: User,
  purpose: EmailTokenPurpose,
  config: EmailConfig,
  email = user.email
) {
  if (!config.enabled || !email) throw new Error('Email is unavailable.')
  const lifetime =
    purpose === 'reset'
      ? config.recovery.tokenMinutes * 60000
      : config.verification.tokenHours * 3600000
  const expiresAt = new Date(Date.now() + lifetime)
  const { token, record } = await issueEmailToken(tx, {
    userId: user.id,
    email,
    purpose,
    expiresAt,
  })
  const path =
    purpose === 'reset' ? '/auth/reset-password' : '/auth/verify-email'
  const url = new URL(path, config.publicUrl)
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
  const matches = await prisma.user.findMany({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
    take: 2,
  })
  if (matches.length !== 1 || !canRecoverPassword(matches[0], config)) return
  await prisma.$transaction(async (tx) => {
    config = await getEmailConfigForUpdate(tx)
    if (!(await isPasswordRecoveryAvailable(config, tx))) return
    const user = await lockEmailUser(tx, matches[0].id)
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
    throw new Error('Password recovery is disabled.')
  const passwordHash = await hash(password, 10)
  await prisma.$transaction(async (tx) => {
    config = await getEmailConfigForUpdate(tx)
    if (!(await isPasswordRecoveryAvailable(config, tx)))
      throw new Error('Password recovery is disabled.')
    const record = await consumeEmailToken(tx, token, ['reset'])
    const user = await lockEmailUser(tx, record.userId)
    if (!canRecoverPassword(user, config) || user.email !== record.email)
      throw new Error('This email link is invalid or expired.')
    await tx.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        sessionVersion: { increment: 1 },
        pendingEmail: null,
        pendingEmailOldConfirmed: false,
        ...(config.recovery.rotateUploadToken
          ? { uploadToken: randomUUID() }
          : {}),
      },
    })
    await invalidateEmailTokens(tx, user.id)
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
  if (!config.enabled || !config.recovery.enabled) return false
  // When changing account state, read SSO policy under the same settings lock.
  const fullConfig = tx
    ? configSchema.parse(
        (await tx.config.findUnique({ where: { key: 'flare_config' } }))
          ?.value ?? DEFAULT_CONFIG
      )
    : await getConfig()
  const oidc = fullConfig.settings.general.oidc
  return !(oidc?.enabled && oidc.enforceSso)
}

export async function confirmEmailToken(token: string, config: EmailConfig) {
  if (!config.enabled) throw new Error('Email is disabled.')
  return prisma.$transaction(async (tx) => {
    // Policy changes and account mutations share a lock; never approve against
    // a request snapshot captured before an administrator tightened the policy.
    config = await getEmailConfigForUpdate(tx)
    if (!config.enabled) throw new Error('Email is disabled.')
    const record = await consumeEmailToken(tx, token, [
      'verify',
      'change',
      'change_approval',
    ])
    const user = await lockEmailUser(tx, record.userId)
    if (record.purpose === 'verify') {
      if (user.email !== record.email)
        throw new Error('This email link is invalid or expired.')
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
    if (!config.changes.enabled || !user.pendingEmail)
      throw new Error('This email change is no longer available.')
    if (record.purpose === 'change_approval') {
      if (record.email !== user.email)
        throw new Error('This email link is invalid or expired.')
      await tx.user.update({
        where: { id: user.id },
        data: { pendingEmailOldConfirmed: true },
      })
      return 'Email change approved. Confirm the link sent to your new address to finish.'
    }
    if (record.email !== user.pendingEmail)
      throw new Error('This email link is invalid or expired.')
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
        throw new Error(
          'This email change requires approval from your current address. Start the email change again to request an approval link.'
        )
      throw new Error(
        'Approve the change using the link sent to your current address first.'
      )
    }
    await lockEmailAddress(tx, record.email)
    const conflict = await tx.user.findFirst({
      where: {
        id: { not: user.id },
        email: { equals: record.email, mode: 'insensitive' },
      },
    })
    if (conflict) throw new Error('This email address is unavailable.')
    const oldEmail = user.email
    await tx.user.update({
      where: { id: user.id },
      data: {
        email: record.email,
        emailVerified: new Date(),
        emailVerifiedFor: record.email,
        emailVerificationSource: 'email',
        pendingEmail: null,
        pendingEmailOldConfirmed: false,
        sessionVersion: { increment: 1 },
      },
    })
    await invalidateEmailTokens(tx, user.id)
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
