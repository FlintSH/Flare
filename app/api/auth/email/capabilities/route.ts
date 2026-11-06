import { getEmailCapabilities } from '@/lib/email/config'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'

const unavailable = 'Email settings are temporarily unavailable'

const api = routes('/api/auth/email/capabilities', {
  // Only the saved and environment email settings are parsed here, so a
  // schema failure means the settings are unusable, not a bad request.
  invalid: () => new HttpError(503, unavailable),
  failure: { status: 503, message: unavailable },
})

export const GET = api(() => getEmailCapabilities())
