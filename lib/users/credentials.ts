import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { randomUUID } from 'node:crypto'

import { sessionRevocation } from '@/lib/auth/security/service'
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
 * What gives an account a new password or sign-in address. The email links
 * already sent are voided and pending security challenges deleted here. The
 * returned changes to its row also cancel a pending email change and sign
 * the account out everywhere, as revoking its sessions does; save them in
 * the caller's one update of the row, so the change is one write and one
 * audit event. Call with the row locked.
 */
export async function changeCredentials(
  tx: Prisma.TransactionClient,
  userId: string,
  { password, email, rotateUploadToken }: CredentialChange
): Promise<Prisma.UserUpdateInput> {
  await invalidateEmailTokens(tx, userId)
  return {
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
    ...(await sessionRevocation(tx, userId)),
  }
}
