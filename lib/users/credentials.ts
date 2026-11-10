import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'

import { sessionRevocation } from '@/lib/auth/security/service'
import { invalidateEmailTokens } from '@/lib/email/tokens'

/**
 * The stored form of an account password: its bcrypt hash. Hash before a
 * transaction, so that no lock waits for bcrypt.
 */
export function hashAccountPassword(password: string) {
  return hash(password, 10)
}

interface CredentialChange {
  /** A new password, as `hashAccountPassword` stores it. */
  password?: string
  /** A new sign-in address; `verified` when a link sent to it confirmed it. */
  email?: { address: string; verified: boolean }
  /**
   * Revoke the upload token from before end-to-end encryption as well.
   * Flare stores only its hash and issues no new one: a tool gets a new
   * configuration with a named token (docs/e2ee-spec.md, section 14.4).
   */
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
    ...(rotateUploadToken && {
      uploadTokenHash: null,
      uploadTokenUsedAt: null,
    }),
    ...(await sessionRevocation(tx, userId)),
  }
}
