import { Prisma, User } from '@prisma/client'
import { compare } from 'bcryptjs'
import type { Session } from 'next-auth'
import { randomBytes } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'

import {
  createTotp,
  decryptTotp,
  encryptTotp,
  newRecoveryCodes,
  recoveryHash,
  totpCounter,
} from './crypto'
import { SecurityError, lockSecurityUser } from './shared'

export type SecurityProof = { password?: string; code?: string }

export function recentAuthentication(session: Session, method: string) {
  const age = Date.now() - (session.user.authTime || 0)
  return session.user.authMethod === method && age >= 0 && age < 5 * 60 * 1000
}

export function assertSessionVersion(user: User, session: Session) {
  if (user.sessionVersion !== session.user.sessionVersion)
    throw new SecurityError('Account security changed. Sign in again.', 401)
}

/** Call with the account row locked: both TOTP and recovery redemption are atomic. */
export async function consumeSecondFactor(
  tx: Prisma.TransactionClient,
  user: User,
  code?: string
): Promise<'totp' | 'recovery' | undefined> {
  if (!user.totpSecret) return
  const normalized = code?.trim() || ''
  if (/^[a-f0-9\s-]{20,80}$/i.test(normalized)) {
    const removed = await tx.recoveryCode.deleteMany({
      where: { userId: user.id, hash: recoveryHash(user.id, normalized) },
    })
    if (removed.count === 1) return 'recovery'
    throw new SecurityError('Invalid or already used authentication code.')
  }
  const counter = totpCounter(decryptTotp(user.totpSecret), normalized)
  if (
    counter !== null &&
    (user.totpLastCounter === null || counter > user.totpLastCounter)
  ) {
    await tx.user.update({
      where: { id: user.id },
      data: { totpLastCounter: counter },
    })
    return 'totp'
  }
  throw new SecurityError('Invalid or already used authentication code.')
}

export async function assertSecurityProof(
  tx: Prisma.TransactionClient,
  user: User,
  proof: SecurityProof,
  session: Session
) {
  assertSessionVersion(user, session)
  if (
    recentAuthentication(session, 'passkey') ||
    recentAuthentication(session, 'recovery')
  )
    return
  if (user.password) {
    if (!proof.password || !(await compare(proof.password, user.password)))
      throw new SecurityError('Confirm your current password to continue.')
    await consumeSecondFactor(tx, user, proof.code)
    return
  }
  if (!user.oidcSubject || !recentAuthentication(session, 'oidc'))
    throw new SecurityError(
      'Sign in again with SSO or a passkey, then retry within five minutes.'
    )
}

export async function issueChallenge(
  tx: Prisma.TransactionClient,
  data: {
    userId?: string
    purpose: string
    challenge: string
    sessionVersion?: number
    payload?: Prisma.InputJsonValue
  }
) {
  await tx.authChallenge.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  if (data.userId)
    await tx.authChallenge.deleteMany({
      where: { userId: data.userId, purpose: data.purpose },
    })
  return tx.authChallenge.create({
    data: {
      ...data,
      id: randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  })
}

export async function consumeChallenge(
  tx: Prisma.TransactionClient,
  id: string,
  purpose: string
) {
  // DELETE RETURNING provides one-use claims even with concurrent requests.
  const challenges = await tx.authChallenge.findMany({
    where: { id, purpose, expiresAt: { gt: new Date() } },
    take: 1,
  })
  const challenge = challenges[0]
  if (
    !challenge ||
    (
      await tx.authChallenge.deleteMany({
        where: { id, purpose, expiresAt: { gt: new Date() } },
      })
    ).count !== 1
  )
    throw new SecurityError(
      'This security challenge expired or was already used. Start again.'
    )
  return challenge
}

export async function revokeSecuritySessions(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.authChallenge.deleteMany({ where: { userId } })
  await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  })
}

async function replaceRecoveryCodes(
  tx: Prisma.TransactionClient,
  userId: string
) {
  const codes = newRecoveryCodes()
  await tx.recoveryCode.deleteMany({ where: { userId } })
  await tx.recoveryCode.createMany({
    data: codes.map((code) => ({ userId, hash: recoveryHash(userId, code) })),
  })
  return codes
}

export async function setupTotp(session: Session, proof: SecurityProof) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    await assertSecurityProof(tx, user, proof, session)
    if (!user.password)
      throw new SecurityError(
        'Authenticator setup requires an existing local password. Manage SSO authentication with your identity provider.'
      )
    if (user.totpSecret)
      throw new SecurityError('Two-factor authentication is already enabled.')
    const totp = createTotp(undefined, user.email || user.id)
    const challenge = await issueChallenge(tx, {
      userId: user.id,
      purpose: 'totp_setup',
      challenge: '',
      sessionVersion: user.sessionVersion,
      payload: { secret: encryptTotp(totp.secret.base32) },
    })
    return {
      secret: totp.secret.base32,
      uri: totp.toString(),
      challengeId: challenge.id,
    }
  })
}

export async function enableTotp(
  session: Session,
  code: string,
  challengeId: string
) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    assertSessionVersion(user, session)
    const pending = await tx.authChallenge.findFirst({
      where: {
        id: challengeId,
        userId: user.id,
        purpose: 'totp_setup',
        expiresAt: { gt: new Date() },
      },
    })
    if (
      !pending ||
      pending.sessionVersion !== user.sessionVersion ||
      user.totpSecret
    )
      throw new SecurityError('Authenticator setup expired. Start again.')
    const secret = (pending.payload as { secret: string }).secret
    const counter = totpCounter(decryptTotp(secret), code)
    if (counter === null)
      throw new SecurityError(
        'Invalid authentication code. Check your device clock and try again.'
      )
    await consumeChallenge(tx, pending.id, 'totp_setup')
    await tx.user.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpLastCounter: counter },
    })
    const recoveryCodes = await replaceRecoveryCodes(tx, user.id)
    await revokeSecuritySessions(tx, user.id)
    return { recoveryCodes, signInAgain: true }
  })
}

export async function changeTotp(
  session: Session,
  proof: SecurityProof,
  disable: boolean
) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    await assertSecurityProof(tx, user, proof, session)
    if (!user.totpSecret)
      throw new SecurityError('Two-factor authentication is not enabled.')
    let recoveryCodes: string[] | undefined
    if (disable) {
      await tx.user.update({
        where: { id: user.id },
        data: { totpSecret: null, totpLastCounter: null },
      })
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } })
    } else recoveryCodes = await replaceRecoveryCodes(tx, user.id)
    await revokeSecuritySessions(tx, user.id)
    return { ...(recoveryCodes ? { recoveryCodes } : {}), signInAgain: true }
  })
}
