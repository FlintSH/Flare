import { accountRequest, readAnswer } from '@/lib/client/account-request'

export async function emailRequest<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  return readAnswer<T>(await fetch(url, { cache: 'no-store', ...init }), {
    signal: init?.signal ?? undefined,
  })
}

export function emailPost<T>(url: string, data: unknown): Promise<T> {
  return accountRequest<T>(url, { method: 'POST', body: data })
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
