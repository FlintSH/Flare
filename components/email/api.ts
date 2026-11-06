import { accountRequest, readAnswer } from '@/lib/client/account-request'
import type { EmailCapabilities } from '@/lib/email/eligibility'

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

/** What this instance's email offers; anyone may ask. */
export function fetchEmailCapabilities() {
  return emailRequest<EmailCapabilities>('/api/auth/email/capabilities')
}
