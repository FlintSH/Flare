export interface AccountPasskey {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export interface SecurityStatus {
  twoFactorEnabled: boolean
  recoveryCodesRemaining: number
  hasPassword: boolean
  passkeys: AccountPasskey[]
  canUseRecentPasskey: boolean
  canUseRecentRecovery: boolean
  canUseRecentPasskeyRecovery: boolean
  canUseRecentSso: boolean
  passkeysAvailable: boolean
  passkeyRequired: boolean
  passkeyRecoveryCodesRemaining: number
}

export function hasRecentSecurityProof(status: SecurityStatus): boolean {
  return (
    status.canUseRecentPasskey ||
    status.canUseRecentPasskeyRecovery ||
    (!status.passkeyRequired && status.canUseRecentRecovery)
  )
}

export function recentSecurityProofName(status: SecurityStatus): string {
  return status.canUseRecentPasskey
    ? 'passkey'
    : status.canUseRecentPasskeyRecovery
      ? 'passkey recovery code'
      : 'recovery code'
}

export async function securityRequest<T>(
  path: string,
  data?: unknown,
  method = data === undefined ? 'GET' : 'POST',
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    cache: 'no-store',
    headers:
      data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      body.error || 'Unable to complete this request. Please try again.'
    )
  }
  return (body.data ?? body) as T
}

export function passkeyError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') {
      return 'The passkey request was canceled or timed out. Try again when you are ready.'
    }
    if (error.name === 'InvalidStateError') {
      return 'This passkey is already registered. Choose another authenticator or use your existing passkey.'
    }
    if (error.name === 'SecurityError') {
      return 'Passkeys need the configured HTTPS address (or localhost). Open your instance at its usual address and try again.'
    }
    return error.message
  }
  return 'Unable to use this passkey. Please try again.'
}
