import type { Prisma, User } from '@prisma/client'

import { sendAccountToken } from '@/lib/email/account'
import type { EmailConfig } from '@/lib/email/schema'
import { ensureBuiltInRoles } from '@/lib/permissions/server'
import { isSetupComplete } from '@/lib/setup/status'

import { newUploadToken } from './credentials'
import { claimEmail } from './email-claim'
import { newUrlId } from './public-id-claim'

type TransactionClient = Prisma.TransactionClient

interface NewAccount {
  email: string
  name: string
  /** A password hash, for an account that signs in with a password. */
  password?: string
  image?: string | null
  oidcSubject?: string
  roleIds?: string[]
  inviteId?: string
  emailVerified?: Date
  emailVerifiedFor?: string
  emailVerificationSource?: string
  emailExempt?: boolean
}

/**
 * How the email settings apply to a new account's address. An address the
 * person typed in (registration, administrators) is checked under the
 * settings and gets a verification link when they ask for one. An identity
 * provider's address only needs to know whether email is enabled.
 */
type NewAccountEmail = { verifyWith: EmailConfig } | { enabled: boolean }

export function verifiesNewAccounts(config: EmailConfig) {
  return (
    config.enabled &&
    (config.verification.mode !== 'off' || config.recovery.enabled)
  )
}

/**
 * Creates an account that claims its address, or returns null when another
 * account already uses it: exactly, or in any letter case while email is
 * enabled. The first account becomes an administrator and a new URL ID is
 * claimed, so call this with `lockRoleChanges` held, after the caller's own
 * authority checks.
 * Setup's first administrator passes no email settings.
 */
export async function createAccount(
  tx: TransactionClient,
  account: NewAccount,
  email: NewAccountEmail = { enabled: false }
): Promise<User | null> {
  const settings = 'verifyWith' in email ? email.verifyWith : null
  const emailEnabled =
    'verifyWith' in email ? email.verifyWith.enabled : email.enabled
  if (!(await claimEmail(tx, account.email, { anyCase: emailEnabled })))
    return null

  const roleIds = [...new Set(account.roleIds ?? [])]
  if (!(await isSetupComplete(tx))) {
    const { administrator } = await ensureBuiltInRoles(tx)
    if (!roleIds.includes(administrator.id)) roleIds.push(administrator.id)
  }
  const verify = settings && verifiesNewAccounts(settings) ? settings : null
  const created = await tx.user.create({
    data: {
      email: account.email,
      name: account.name,
      image: account.image,
      password: account.password,
      oidcSubject: account.oidcSubject,
      emailVerified: account.emailVerified,
      emailVerifiedFor: account.emailVerifiedFor,
      emailVerificationSource: verify
        ? 'pending_local'
        : account.emailVerificationSource,
      emailExempt: account.emailExempt,
      urlId: await newUrlId(tx),
      roles: { connect: roleIds.map((id) => ({ id })) },
      ...(account.inviteId
        ? { invite: { connect: { id: account.inviteId } } }
        : {}),
      uploadToken: newUploadToken(),
    },
  })
  if (verify) await sendAccountToken(tx, created, 'verify', verify)
  return created
}
