import { emailLinkAvailable } from './links'
import type { EmailConfig } from './schema'

export interface EmailPolicyUser {
  email: string | null
  emailVerified: Date | null
  emailVerifiedFor: string | null
  emailVerificationSource?: string | null
  emailExempt: boolean
  createdAt: Date
}

type VerificationMode = EmailConfig['verification']['mode']

/** The verification mode in force: `off` while email is disabled. */
export function effectiveVerificationMode(
  config: Pick<EmailConfig, 'enabled' | 'verification'>
): VerificationMode {
  return config.enabled ? config.verification.mode : 'off'
}

/** Whether a mode makes accounts verify their address before using Flare. */
export function isEnforcedVerificationMode(mode: VerificationMode) {
  return mode === 'new_users' || mode === 'all_users'
}

/** A legacy timestamp alone never establishes mailbox ownership. */
export function hasVerifiedEmail(
  user: Pick<
    EmailPolicyUser,
    'email' | 'emailVerified' | 'emailVerifiedFor' | 'emailVerificationSource'
  >,
  config?: Pick<EmailConfig, 'verification'>
) {
  const trustedSource =
    user.emailVerificationSource === 'email' ||
    (user.emailVerificationSource === 'oidc' && config?.verification.trustOidc)
  return Boolean(
    user.email &&
    user.emailVerified &&
    user.emailVerifiedFor === user.email &&
    trustedSource
  )
}

/** An exempt account, or one with a verified address, meets every verification mode. */
export function satisfiesEmailPolicy(
  user: Omit<EmailPolicyUser, 'createdAt'>,
  config: Pick<EmailConfig, 'verification'>
) {
  return user.emailExempt || hasVerifiedEmail(user, config)
}

export function requiresEmailVerification(
  user: EmailPolicyUser,
  config: EmailConfig,
  now = new Date()
) {
  if (!config.enabled || satisfiesEmailPolicy(user, config)) return false
  const policy = config.verification
  if (!isEnforcedVerificationMode(policy.mode)) return false
  if (policy.mode === 'new_users') {
    if (
      !policy.requiredSince ||
      user.createdAt < new Date(policy.requiredSince)
    )
      return false
    return true
  }
  if (policy.requiredSince && user.createdAt >= new Date(policy.requiredSince))
    return true
  return !policy.graceEndsAt || now >= new Date(policy.graceEndsAt)
}

/**
 * When an account must verify its address to keep access: the end of the
 * all-user grace period that still lets it in. Null when no deadline applies.
 */
export function verificationDeadline(
  user: EmailPolicyUser,
  config: EmailConfig,
  now = new Date()
) {
  const { graceEndsAt } = config.verification
  if (
    effectiveVerificationMode(config) !== 'all_users' ||
    !graceEndsAt ||
    satisfiesEmailPolicy(user, config) ||
    requiresEmailVerification(user, config, now)
  )
    return null
  return graceEndsAt
}

export function canRecoverPassword(
  user: EmailPolicyUser & { password: string | null },
  config: EmailConfig
) {
  return (
    emailLinkAvailable(config, 'reset') &&
    Boolean(user.password) &&
    hasVerifiedEmail(user, config)
  )
}

/** All-user grace must not hide the loss of the last usable administrator. */
export function hasDurableEmailAccess(
  user: EmailPolicyUser,
  config: EmailConfig
) {
  if (effectiveVerificationMode(config) === 'all_users')
    return satisfiesEmailPolicy(user, config)
  return !requiresEmailVerification(user, config)
}
