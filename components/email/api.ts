export async function emailRequest<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      body.error || 'Unable to complete this request. Please try again.'
    )
  }
  return (body.data ?? body) as T
}

export function emailPost<T>(url: string, data: unknown): Promise<T> {
  return emailRequest<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export interface EmailCapabilities {
  enabled: boolean
  recoveryEnabled: boolean
  verificationMode: 'off' | 'optional' | 'new_users' | 'all_users'
  changesEnabled: boolean
}

export interface AccountEmailStatus {
  enabled: boolean
  recoveryEnabled: boolean
  verificationMode: EmailCapabilities['verificationMode']
  verified: boolean
  exempt: boolean
  required: boolean
  pendingEmail: string | null
  canChangeEmail: boolean
  canEnroll: boolean
  canResend: boolean
  hasPassword: boolean
  requiresPassword: boolean
  requiresOldEmail: boolean
  resendSeconds: number
  graceEndsAt: string | null
}
