import {
  type SecurityStatus,
  hasRecentSecurityProof,
} from '@/components/auth/security-api'

export const PASSPHRASE_CONFIRMATION_NEEDED =
  'Confirm your passphrase to continue. Your confirmation lasts five minutes.'

type RefreshSecurity = () => Promise<{
  data?: SecurityStatus
  error: Error | null
}>

/** Reveal expired proof controls before submitting an account-security change. */
export async function checkManagementProof(
  refresh: RefreshSecurity,
  proof: { password?: string; code?: string },
  requirePasskey = false
): Promise<string | null> {
  const result = await refresh()
  if (result.error) throw result.error
  if (!result.data) throw new Error('Unable to refresh your security settings.')
  const status = result.data
  const recent = requirePasskey
    ? status.canUseRecentPasskey
    : hasRecentSecurityProof(status)
  if (recent) return null
  if (requirePasskey || status.passkeyRequired)
    return 'Confirm with a passkey again to continue. Your passkey confirmation lasts five minutes.'
  if (status.hasPassphrase) {
    // The server takes a passphrase sign-in of the last five minutes, and
    // still uses up an authenticator code.
    if (!status.canUseRecentPassphrase) return PASSPHRASE_CONFIRMATION_NEEDED
    return status.twoFactorEnabled && !proof.code?.trim()
      ? 'Enter an authenticator or recovery code to continue.'
      : null
  }
  if (!status.hasPassword)
    return status.canUseRecentSso
      ? null
      : 'Confirm your identity with SSO again before making this change.'
  if (!proof.password) return 'Enter your current password to continue.'
  if (status.twoFactorEnabled && !proof.code?.trim())
    return 'Enter an authenticator or recovery code to continue.'
  return null
}
