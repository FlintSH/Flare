import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { randomUUID } from 'node:crypto'

import { revokeSecuritySessions } from '@/lib/auth/security/service'
import { invalidateEmailTokens } from '@/lib/email/tokens'

/**
 * The stored form of an account password: its bcrypt hash. Hash before a
 * transaction, so that no lock waits for bcrypt.
 */
export function hashAccountPassword(password: string) {
  return hash(password, 10)
}

/** A new legacy upload token. */
export function newUploadToken() {
  return randomUUID()
}

interface CredentialChange {
  /** A new password, as `hashAccountPassword` stores it. */
  password?: string
  /** A new sign-in address; `verified` when a link sent to it confirmed it. */
  email?: { address: string; verified: boolean }
  /** Replace the legacy upload token as well. */
  rotateUploadToken?: boolean
}

/**
 * Gives an account a new password or sign-in address. Like revoking its
 * sessions, this signs the account out everywhere; a credential change also
 * cancels a pending email change and voids the email links already sent.
 * Call with the account row locked.
 */
export async function changeCredentials(
  tx: Prisma.TransactionClient,
  userId: string,
  { password, email, rotateUploadToken }: CredentialChange
) {
  await tx.user.update({
    where: { id: userId },
    data: {
      ...(password !== undefined && { password }),
      ...(email && {
        email: email.address,
        emailVerified: email.verified ? new Date() : null,
        emailVerifiedFor: email.verified ? email.address : null,
        emailVerificationSource: email.verified ? 'email' : null,
      }),
      pendingEmail: null,
      pendingEmailOldConfirmed: false,
      ...(rotateUploadToken && { uploadToken: newUploadToken() }),
    },
  })
  await invalidateEmailTokens(tx, userId)
  await revokeSecuritySessions(tx, userId)
}
