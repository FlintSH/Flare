import type { Prisma, User } from '@prisma/client'
import type { Session } from 'next-auth'

import { prisma } from '@/lib/database/prisma'

import { newPasskeyRecoveryCodes, passkeyRecoveryHash } from './crypto'
import { hasFallbackSignIn } from './fallback'
import {
  assertSessionVersion,
  recentAuthentication,
  revokeSecuritySessions,
} from './service'
import { SecurityError, lockSecurityUser } from './shared'

/** Policy-changing actions never fall back to password, TOTP, or ordinary SSO. */
export function assertRecentPasskeyProof(
  user: User,
  session: Session,
  allowRecovery = true
) {
  assertSessionVersion(user, session)
  if (
    recentAuthentication(session, 'passkey') ||
    (allowRecovery && recentAuthentication(session, 'passkey-recovery'))
  )
    return
  throw new SecurityError(
    allowRecovery
      ? 'Sign in again with a passkey or a passkey recovery code, then retry within five minutes.'
      : 'Sign in again with a passkey, then retry within five minutes.'
  )
}

async function replacePasskeyRecoveryCodes(
  tx: Prisma.TransactionClient,
  userId: string
) {
  const recoveryCodes = newPasskeyRecoveryCodes()
  await tx.passkeyRecoveryCode.deleteMany({ where: { userId } })
  await tx.passkeyRecoveryCode.createMany({
    data: recoveryCodes.map((code) => ({
      userId,
      hash: passkeyRecoveryHash(userId, code),
    })),
  })
  return recoveryCodes
}

export async function setPasskeyRequired(session: Session, required: boolean) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    assertRecentPasskeyProof(user, session, !required)
    if (user.passkeyRequired === required)
      throw new SecurityError(
        required
          ? 'Passkey sign-in is already required.'
          : 'Passkey sign-in is already optional.'
      )
    let recoveryCodes: string[] | undefined
    if (required) {
      if (!user.email)
        throw new SecurityError(
          'Add an email address before requiring passkeys so you can use recovery codes.'
        )
      if ((await tx.passkey.count({ where: { userId: user.id } })) < 1)
        throw new SecurityError(
          'Add and sign in with a passkey before requiring it.'
        )
      recoveryCodes = await replacePasskeyRecoveryCodes(tx, user.id)
    } else {
      if (!(await hasFallbackSignIn(tx, user)))
        throw new SecurityError(
          'Set up an available password or restore your configured SSO provider before turning off required passkey sign-in.'
        )
      await tx.passkeyRecoveryCode.deleteMany({ where: { userId: user.id } })
    }
    await tx.user.update({
      where: { id: user.id },
      data: { passkeyRequired: required },
    })
    await revokeSecuritySessions(tx, user.id)
    return { ...(recoveryCodes ? { recoveryCodes } : {}), signInAgain: true }
  })
}

export async function rotatePasskeyRecoveryCodes(session: Session) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    assertRecentPasskeyProof(user, session)
    if (!user.passkeyRequired)
      throw new SecurityError(
        'Require passkeys before generating passkey recovery codes.'
      )
    const recoveryCodes = await replacePasskeyRecoveryCodes(tx, user.id)
    await revokeSecuritySessions(tx, user.id)
    return { recoveryCodes, signInAgain: true }
  })
}

/** Emergency credentials are independent of passwords and authenticator codes. */
export async function authenticatePasskeyRecovery(email: string, code: string) {
  const normalized = code.replace(/[\s-]/g, '').toLowerCase()
  if (!/^[a-f0-9]{32}$/.test(normalized)) return null
  const account = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, sessionVersion: true },
  })
  if (!account) return null
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, account.id)
    if (
      !user.passkeyRequired ||
      user.email !== account.email ||
      user.sessionVersion !== account.sessionVersion
    )
      return null
    const removed = await tx.passkeyRecoveryCode.deleteMany({
      where: {
        userId: user.id,
        hash: passkeyRecoveryHash(user.id, normalized),
      },
    })
    return removed.count === 1 ? user : null
  })
}
