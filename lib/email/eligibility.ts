import { localSignInAllowed } from '@/lib/config/oidc'

import { emailLinkAvailable } from './links'
import {
  type EmailPolicyUser,
  effectiveVerificationMode,
  hasVerifiedEmail,
  requiresEmailVerification,
  verificationDeadline,
} from './policy'
import type { EmailConfig } from './schema'

// What this instance's email offers and what an account may do with its own,
// one rule each, for the email routes, the workflows and the forms.
// Browser-safe.

type SsoSettings = Parameters<typeof localSignInAllowed>[0]
type VerificationMode = EmailConfig['verification']['mode']

export interface EmailStatusUser extends EmailPolicyUser {
  password: string | null
  pendingEmail: string | null
}

/** `GET /api/auth/email/capabilities`, which anyone may ask. */
export interface EmailCapabilities {
  enabled: boolean
  /** Password recovery by email, which enforced SSO turns off. */
  recoveryEnabled: boolean
  /** The mode in force: `off` while email is disabled. */
  verificationMode: VerificationMode
  changesEnabled: boolean
}

/** `GET /api/users/{id}/email`: an account's email, for an administrator. */
export interface UserEmailStatus {
  verified: boolean
  exempt: boolean
  required: boolean
  pendingEmail: string | null
  canResend: boolean
}

/** `GET /api/auth/email/status`: the signed-in account's email and what it may do with it. */
export interface AccountEmailStatus {
  enabled: boolean
  recoveryEnabled: boolean
  /** The saved mode, also while email is disabled. */
  verificationMode: VerificationMode
  verified: boolean
  exempt: boolean
  required: boolean
  pendingEmail: string | null
  /** Address changes are on for this instance. */
  canChangeEmail: boolean
  canEnroll: boolean
  canResend: boolean
  hasPassword: boolean
  /** The same as `hasPassword`. */
  requiresPassword: boolean
  requiresOldEmail: boolean
  resendSeconds: number
  /** The instance's all-user grace end, whether or not it applies to this account. */
  graceEndsAt: string | null
  /** This account may ask for a new address now; see `canRequestEmailChange`. */
  canRequestChange: boolean
  /** When this account must verify its address to keep access, or null. */
  verifyBy: string | null
}

export function emailChangesEnabled(config: EmailConfig) {
  return emailLinkAvailable(config, 'change')
}

/** The current address must approve a change, and it can't before it is verified. */
export function currentAddressMustVerify(
  user: EmailPolicyUser,
  config: EmailConfig
) {
  return config.changes.requireOldEmail && !hasVerifiedEmail(user, config)
}

export function canRequestEmailChange(
  user: EmailPolicyUser,
  config: EmailConfig
) {
  return emailChangesEnabled(config) && !currentAddressMustVerify(user, config)
}

/** Whether a verification link can be sent again: the account enrolled its address and hasn't verified it yet. */
export function canResendVerification(
  user: EmailPolicyUser,
  config: EmailConfig
) {
  return (
    config.enabled &&
    !hasVerifiedEmail(user, config) &&
    user.emailVerificationSource === 'pending_local'
  )
}

export function passwordRecoveryAvailable(
  config: EmailConfig,
  sso: SsoSettings
) {
  return emailLinkAvailable(config, 'reset') && localSignInAllowed(sso)
}

export function emailCapabilities(
  config: EmailConfig,
  sso: SsoSettings
): EmailCapabilities {
  return {
    enabled: config.enabled,
    recoveryEnabled: passwordRecoveryAvailable(config, sso),
    verificationMode: effectiveVerificationMode(config),
    changesEnabled: emailChangesEnabled(config),
  }
}

export function userEmailStatus(
  user: EmailStatusUser,
  config: EmailConfig
): UserEmailStatus {
  return {
    verified: hasVerifiedEmail(user, config),
    exempt: user.emailExempt,
    required: requiresEmailVerification(user, config),
    pendingEmail: user.pendingEmail,
    canResend: canResendVerification(user, config),
  }
}

export function accountEmailStatus(
  user: EmailStatusUser,
  config: EmailConfig,
  sso: SsoSettings
): AccountEmailStatus {
  const { canResend, ...state } = userEmailStatus(user, config)
  const hasPassword = Boolean(user.password)
  return {
    enabled: config.enabled,
    recoveryEnabled: passwordRecoveryAvailable(config, sso),
    verificationMode: config.verification.mode,
    ...state,
    canChangeEmail: emailChangesEnabled(config),
    canEnroll: config.enabled && !state.verified,
    canResend,
    hasPassword,
    requiresPassword: hasPassword,
    requiresOldEmail: config.changes.requireOldEmail,
    resendSeconds: config.limits.resendSeconds,
    graceEndsAt: config.verification.graceEndsAt,
    canRequestChange: canRequestEmailChange(user, config),
    verifyBy: verificationDeadline(user, config),
  }
}
