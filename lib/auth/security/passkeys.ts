import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { Session } from 'next-auth'
import { randomBytes } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'

import { securityHash, webauthnUserId } from './crypto'
import { hasFallbackSignIn } from './fallback'
import {
  type SecurityProof,
  assertSecurityProof,
  assertSessionVersion,
  consumeChallenge,
  issueChallenge,
  revokeSecuritySessions,
} from './service'
import { SecurityError, lockSecurityUser, relyingParty } from './shared'

export function passkeyCookieName() {
  return relyingParty().origin.startsWith('https:')
    ? '__Host-flare-passkey-challenge'
    : 'flare-passkey-challenge'
}

export async function registrationOptions(
  session: Session,
  proof: SecurityProof,
  name: string
) {
  const rp = relyingParty()
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    await assertSecurityProof(tx, user, proof, session)
    const passkeys = await tx.passkey.findMany({ where: { userId: user.id } })
    if (passkeys.length >= 10)
      throw new SecurityError(
        'You can save up to 10 passkeys. Remove one before adding another.'
      )
    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userID: webauthnUserId(user.id),
      userName: user.email || user.id,
      userDisplayName: user.name || user.email || 'Flare account',
      attestationType: 'none',
      excludeCredentials: passkeys.map((key) => ({
        id: key.id,
        transports: key.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    })
    const challenge = await issueChallenge(tx, {
      userId: user.id,
      purpose: 'passkey_registration',
      challenge: options.challenge,
      sessionVersion: user.sessionVersion,
      payload: { name },
    })
    return { options, challengeId: challenge.id }
  })
}

export async function registerPasskey(
  session: Session,
  challengeId: string,
  response: RegistrationResponseJSON
) {
  const rp = relyingParty()
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    assertSessionVersion(user, session)
    const challenge = await consumeChallenge(
      tx,
      challengeId,
      'passkey_registration'
    )
    if (
      challenge.userId !== user.id ||
      challenge.sessionVersion !== user.sessionVersion
    )
      throw new SecurityError('Account security changed. Start again.')
    if ((await tx.passkey.count({ where: { userId: user.id } })) >= 10)
      throw new SecurityError('You can save up to 10 passkeys.')
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    })
    if (!verification.verified)
      throw new SecurityError('Unable to verify this passkey.')
    const credential = verification.registrationInfo.credential
    await tx.passkey.create({
      data: {
        id: credential.id,
        userId: user.id,
        name: (challenge.payload as { name: string }).name,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports || [],
      },
    })
    await revokeSecuritySessions(tx, user.id)
    return { signInAgain: true }
  })
}

export async function authenticationOptions() {
  const rp = relyingParty()
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
  })
  const binding = randomBytes(32).toString('base64url')
  const challenge = await prisma.$transaction((tx) =>
    issueChallenge(tx, {
      purpose: 'passkey_login',
      challenge: options.challenge,
      payload: { binding: securityHash(binding) },
    })
  )
  return { options, challengeId: challenge.id, binding }
}

export async function authenticatePasskey(
  challengeId: string,
  response: AuthenticationResponseJSON,
  binding: string,
  expectedUserId?: string
) {
  const rp = relyingParty()
  return prisma.$transaction(async (tx) => {
    const challenge = await consumeChallenge(tx, challengeId, 'passkey_login')
    if (
      !binding ||
      (challenge.payload as { binding: string }).binding !==
        securityHash(binding)
    )
      throw new SecurityError(
        'This passkey request belongs to another browser.'
      )
    const key = await tx.passkey.findUnique({ where: { id: response.id } })
    if (!key) throw new SecurityError('Unable to sign in with this passkey.')
    const user = await lockSecurityUser(tx, key.userId)
    if (expectedUserId && user.id !== expectedUserId)
      throw new SecurityError(
        'Choose a passkey for the account you are managing.'
      )
    // Re-read after locking the account to serialize deletion and counter updates.
    const fresh = await tx.passkey.findUnique({ where: { id: key.id } })
    if (!fresh) throw new SecurityError('Unable to sign in with this passkey.')
    if (
      response.response.userHandle !==
      Buffer.from(webauthnUserId(user.id)).toString('base64url')
    )
      throw new SecurityError('Unable to sign in with this passkey.')
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: fresh.id,
        publicKey: new Uint8Array(fresh.publicKey),
        counter: Number(fresh.counter),
        transports: fresh.transports as AuthenticatorTransport[],
      },
    })
    if (!verification.verified)
      throw new SecurityError('Unable to sign in with this passkey.')
    await tx.passkey.update({
      where: { id: fresh.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    })
    return user
  })
}

export async function changePasskey(
  session: Session,
  id: string,
  proof: SecurityProof,
  name?: string
) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    await assertSecurityProof(tx, user, proof, session)
    const key = await tx.passkey.findFirst({ where: { id, userId: user.id } })
    if (!key) throw new SecurityError('Passkey not found.', 404)
    if (name !== undefined) {
      await tx.passkey.update({ where: { id }, data: { name } })
      return { success: true }
    }
    if (
      user.passkeyRequired &&
      (await tx.passkey.count({ where: { userId: user.id } })) <= 1
    )
      throw new SecurityError(
        'Add another passkey or turn off required passkey sign-in before removing your last passkey.'
      )

    if (
      (await tx.passkey.count({ where: { userId: user.id } })) <= 1 &&
      !(await hasFallbackSignIn(tx, user))
    )
      throw new SecurityError(
        'Keep a passkey until a password or your configured SSO provider is available.'
      )
    await tx.passkey.delete({ where: { id } })
    await revokeSecuritySessions(tx, user.id)
    return { signInAgain: true }
  })
}
