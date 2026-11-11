import type { Prisma, User } from '@prisma/client'
import type { Session } from 'next-auth'

import { RECENT_PROOF_MINUTES } from '@/lib/auth/security/policy'
import { assertSessionVersion } from '@/lib/auth/security/service'
import { SecurityError, lockSecurityUser } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { isPasswordRecoveryAvailable, lockEmailUser } from '@/lib/email/account'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { EmailHttpError } from '@/lib/email/errors'
import { MailLimitError, enqueueMail } from '@/lib/email/outbox'
import { canRecoverPassword } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
import { renderAccountEmail } from '@/lib/email/templates'
import { consumeEmailToken, findEmailToken } from '@/lib/email/tokens'
import { changeCredentials } from '@/lib/users/credentials'

import {
  type RotatedLibrary,
  replaceLibraryRecords,
  resetLibraryRecords,
} from './library-records'
import {
  type AccountRecordInput,
  type StoredBytes,
  accountRecordColumns,
  hasAccountKeys,
  sameBytes,
} from './records'

// The changes to the account record of docs/e2ee-spec.md: key setup (sections
// 5.4 and 14.1), rotation (8.3.3), the keyring (8.3.4), recovery (6.8) and
// reset (6.9). Each function trusts that its caller checked the proofs that
// its section names, and checks again under the row lock that the account is
// still the one those proofs were about.

const INVALID_LINK = 'This email link is invalid or expired.'

/** The keys that the proofs of a request were checked against. */
export interface ProvenKeys {
  accountPublicKey: Uint8Array | null
  authPublicKey: Uint8Array | null
  sessionVersion: number
}

function assertKeysUnchanged(fresh: User, proven: ProvenKeys) {
  if (
    fresh.sessionVersion !== proven.sessionVersion ||
    !sameBytes(fresh.accountPublicKey, proven.accountPublicKey) ||
    !sameBytes(fresh.authPublicKey, proven.authPublicKey)
  )
    throw new SecurityError('Account security changed. Sign in again.', 401)
}

/**
 * Whether the session comes from a sign-in a short time ago, by any method.
 * Each method applies the second-factor rules of the account, so the sign-in
 * is the proof that the owner is present. A sign-in time ahead of the clock
 * never counts.
 */
function recentSignIn(session: Session) {
  const age = Date.now() - (session.user.authTime || 0)
  return age >= 0 && age < RECENT_PROOF_MINUTES * 60_000
}

/**
 * Key setup for a signed-in account that has no keys (section 14.1): an
 * account from before encryption, and an account that signs in with a
 * passkey or OIDC and now selects a passphrase. The password hash is deleted
 * in the same update, so the old password sign-in stops for this account.
 *
 * The session must come from a recent sign-in. The request carries no
 * password: the client does key setup immediately after sign-in (section
 * 14.1, step 2), and a stolen older session cannot replace the sign-in
 * secret of the account. The session continues: the client unlocks next.
 */
export async function setUpAccountKeys(
  session: Session,
  record: AccountRecordInput
) {
  return prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, session.user.id)
    assertSessionVersion(user, session)
    if (hasAccountKeys(user))
      throw new SecurityError(
        'This account already has keys. Change the passphrase instead.',
        409,
        { body: { code: 'keys_exist' } }
      )
    // Each signature of the sign-in key binds to the address (section 6.2).
    if (!user.email)
      throw new SecurityError(
        'Add a sign-in email address to this account before setting up encryption.',
        409
      )
    if (!recentSignIn(session))
      throw new SecurityError(
        'Sign in again, then set up encryption within five minutes.',
        403,
        { body: { code: 'recent_sign_in_required' } }
      )
    await tx.user.update({
      where: { id: user.id },
      data: accountRecordColumns(record),
    })
  })
}

/**
 * Steps 7 and 8 of section 8.3.3 and step 4 of section 6.9, in the caller's
 * transaction with the account row locked: replaces the account record and
 * the keyring, then cancels what the old secrets could have reached.
 *
 * - Every browser session ends, the one that made the request too: the
 *   session version moves on, which also fences a sign-in that verified the
 *   old key and has no session yet. The client signs in with the new
 *   passphrase.
 * - Every named API token is deleted and the legacy upload token is replaced.
 * - Pending challenges, email links and a pending address change are voided.
 *
 * A token request that is in flight inserts after this transaction: it waits
 * for the row lock that its foreign key takes. No advisory lock is taken
 * here, because the token routes take theirs before that row lock.
 */
async function replaceAccountRecord(
  tx: Prisma.TransactionClient,
  userId: string,
  record: AccountRecordInput,
  sealedKeyring: StoredBytes | null,
  /**
   * The folder keys and tag records sealed for the new account key (sections
   * 8.4.2 and 9.5.5). Null for a reset: no key opens the old ones, so they
   * are given up (section 6.9).
   */
  library: RotatedLibrary | null
) {
  await tx.apiToken.deleteMany({ where: { userId } })
  if (library) await replaceLibraryRecords(tx, userId, library)
  else await resetLibraryRecords(tx, userId)
  await tx.user.update({
    where: { id: userId },
    data: {
      ...accountRecordColumns(record),
      sealedKeyring,
      ...(await changeCredentials(tx, userId, { rotateUploadToken: true })),
    },
  })
}

/**
 * Key rotation and passphrase change (sections 6.7 and 8.3.3). The caller
 * verified both proofs against `proven`: the signed request with the old
 * account key and the sign-in signature with the old sign-in key.
 */
export async function rotateAccountKeys(
  userId: string,
  proven: ProvenKeys,
  record: AccountRecordInput,
  sealedKeyring: StoredBytes | null,
  library: RotatedLibrary
) {
  await prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, userId)
    assertKeysUnchanged(user, proven)
    assertNewKeys(user, record)
    await replaceAccountRecord(tx, user.id, record, sealedKeyring, library)
  })
}

/** A rotation makes each key again (section 8.3): the old public keys and salt must not come back. */
function assertNewKeys(user: User, record: AccountRecordInput) {
  if (
    sameBytes(user.accountPublicKey, record.accountPublicKey) ||
    sameBytes(user.authPublicKey, record.authPublicKey) ||
    sameBytes(user.passphraseSalt, record.passphraseSalt)
  )
    throw new SecurityError(
      'A rotation needs a new account key, a new salt and a new passphrase.'
    )
}

/**
 * Step 5 of section 8.3.4: the keyring without the old keys that have no
 * stanza left, or none at all. The caller verified the signed request with
 * the current account key.
 */
export async function replaceKeyring(
  userId: string,
  proven: ProvenKeys,
  sealedKeyring: StoredBytes | null
) {
  await prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, userId)
    assertKeysUnchanged(user, proven)
    await tx.user.update({
      where: { id: user.id },
      data: { sealedKeyring },
    })
  })
}

/** What an email reset link can do for its account now. */
export interface ResetLinkAccount {
  id: string
  sessionVersion: number
  accountPublicKey: Uint8Array | null
  authPublicKey: Uint8Array | null
  sealedKeyring: StoredBytes | null
  e2eeProtocolVersion: number | null
}

/**
 * The account of a reset link that is still valid, without using the link up.
 * The link stays valid until a recovery or a reset succeeds.
 */
export async function readResetLink(
  token: string,
  config: EmailConfig
): Promise<ResetLinkAccount> {
  if (!(await isPasswordRecoveryAvailable(config)))
    throw new EmailHttpError('Password recovery is disabled.')
  const record = await findEmailToken(prisma, token, ['reset'])
  const user =
    record && (await prisma.user.findUnique({ where: { id: record.userId } }))
  if (!user || !canRecoverPassword(user, config) || user.email !== record.email)
    throw new EmailHttpError(INVALID_LINK)
  return user
}

/**
 * Uses the reset link up and replaces the account record, for recovery with
 * the mnemonic (section 6.8) and for reset without it (section 6.9).
 *
 * `proven` is set for a recovery: the caller verified the signed request
 * with the account key that the mnemonic gives, and the keyring continues.
 * Without it this is a reset: the email link is the only proof, the account
 * gets keys that open none of its old encrypted files, and the keyring is
 * deleted. A reset also gives keys to an account that has none.
 */
export async function replaceKeysByEmail(
  token: string,
  config: EmailConfig,
  record: AccountRecordInput,
  recovery?: {
    proven: ProvenKeys
    sealedKeyring: StoredBytes | null
    library: RotatedLibrary
  }
) {
  if (!(await isPasswordRecoveryAvailable(config)))
    throw new EmailHttpError('Password recovery is disabled.')
  await prisma.$transaction(async (tx) => {
    config = await getEmailConfigForUpdate(tx)
    if (!(await isPasswordRecoveryAvailable(config, tx)))
      throw new EmailHttpError('Password recovery is disabled.')
    const link = await consumeEmailToken(tx, token, ['reset'])
    const user = await lockEmailUser(tx, link.userId)
    if (!canRecoverPassword(user, config) || user.email !== link.email)
      throw new EmailHttpError(INVALID_LINK)
    if (recovery) {
      assertKeysUnchanged(user, recovery.proven)
      assertNewKeys(user, record)
    }
    // A reset (`!recovery`) marks each encrypted file of the account as
    // unreadable and gives up the sealed folder and tag records (section
    // 6.9, step 4). A reset of an account that had no keys changes nothing
    // there: it has no encrypted file.
    await replaceAccountRecord(
      tx,
      user.id,
      record,
      recovery ? recovery.sealedKeyring : null,
      recovery ? recovery.library : null
    )
    const message = renderAccountEmail(config, {
      kind: 'password_changed',
      recipient: link.email,
      username: user.name || undefined,
    })
    try {
      await enqueueMail(
        tx,
        {
          userId: user.id,
          purpose: 'password_changed',
          recipient: link.email,
          ...message,
        },
        config
      )
    } catch (error) {
      if (!(error instanceof MailLimitError)) throw error
    }
  })
}
