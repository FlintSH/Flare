import { apiRequest } from '@/lib/client/request'
import type { EmailCapabilities } from '@/lib/email/eligibility'

/** What this instance's email offers; anyone may ask. */
export function fetchEmailCapabilities() {
  return apiRequest<EmailCapabilities>('/api/auth/email/capabilities')
}
