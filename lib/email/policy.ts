import type { EmailConfig } from './schema'

export interface EmailPolicyUser {
  email: string | null
  emailVerified: Date | null
  emailVerifiedFor: string | null
  emailVerificationSource?: string | null
  emailExempt: boolean
  createdAt: Date
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

export function requiresEmailVerification(
  user: EmailPolicyUser,
  config: EmailConfig,
  now = new Date()
) {
  if (!config.enabled || user.emailExempt || hasVerifiedEmail(user, config))
    return false
  const policy = config.verification
  if (policy.mode === 'off' || policy.mode === 'optional') return false
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

export function canRecoverPassword(
  user: EmailPolicyUser & { password: string | null },
  config: EmailConfig
) {
  return (
    config.enabled &&
    config.recovery.enabled &&
    Boolean(user.password) &&
    hasVerifiedEmail(user, config)
  )
}

/** All-user grace must not hide the loss of the last usable administrator. */
export function hasDurableEmailAccess(
  user: EmailPolicyUser,
  config: EmailConfig
) {
  if (config.enabled && config.verification.mode === 'all_users') {
    return user.emailExempt || hasVerifiedEmail(user, config)
  }
  return !requiresEmailVerification(user, config)
}
