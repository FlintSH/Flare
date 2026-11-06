import { getEmailCapabilities } from '@/lib/email/config'
import { unavailable } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'

const message = 'Email settings are temporarily unavailable'

const api = routes('/api/auth/email/capabilities', { failure: { message } })

// Only the saved and environment email settings are read here, so a failure
// means they are unusable, not that the request was wrong.
export const GET = api(() => getEmailCapabilities().catch(unavailable(message)))
