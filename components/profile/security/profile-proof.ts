import type { SecurityStatus } from '@/components/auth/security-api'

type RefreshSecurity = () => Promise<{
  data?: SecurityStatus
  error: Error | null
}>

/** Recheck server proof eligibility before sending a sensitive profile mutation. */
export async function checkProfileProof(
  refresh: RefreshSecurity,
  change: 'password' | 'email',
  proof: { currentPassword?: string; securityCode?: string }
): Promise<string | null> {
  const result = await refresh()
  if (result.error) throw result.error
  if (!result.data)
    throw new Error('Unable to confirm your identity. Please try again.')
  const status = result.data
  const recent = status.canUseRecentPasskey || status.canUseRecentRecovery

  if (change === 'password') {
    if (!status.hasPassword)
      return 'Change your SSO password with your identity provider.'
    if (!proof.currentPassword)
      return 'Enter your current password to continue.'
  }
  if (recent) return null
  if (!status.hasPassword) {
    return status.canUseRecentSso
      ? null
      : 'Confirm your identity with SSO again before changing your email address.'
  }
  if (!proof.currentPassword) return 'Enter your current password to continue.'
  if (status.twoFactorEnabled && !proof.securityCode?.trim()) {
    return 'Enter an authenticator or recovery code to continue.'
  }
  return null
}
