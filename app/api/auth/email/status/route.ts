import { isPasswordRecoveryAvailable } from '@/lib/email/account'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { hasVerifiedEmail, requiresEmailVerification } from '@/lib/email/policy'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/status', emailRoutes)

export const GET = api(async () => {
  const { user, config } = await emailSession()
  return {
    enabled: config.enabled,
    recoveryEnabled: await isPasswordRecoveryAvailable(config),
    verificationMode: config.verification.mode,
    verified: hasVerifiedEmail(user, config),
    exempt: user.emailExempt,
    required: requiresEmailVerification(user, config),
    pendingEmail: user.pendingEmail,
    canChangeEmail: config.enabled && config.changes.enabled,
    canEnroll: config.enabled && !hasVerifiedEmail(user, config),
    canResend:
      config.enabled &&
      !hasVerifiedEmail(user, config) &&
      user.emailVerificationSource === 'pending_local',
    hasPassword: Boolean(user.password),
    requiresPassword: Boolean(user.password),
    requiresOldEmail: config.changes.requireOldEmail,
    resendSeconds: config.limits.resendSeconds,
    graceEndsAt: config.verification.graceEndsAt,
  }
})
