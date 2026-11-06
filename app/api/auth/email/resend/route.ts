import { requireEmailAddress, resendVerification } from '@/lib/email/account'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/resend', emailRoutes)

export const POST = api(async (request) => {
  const account = await emailSession(request)
  const address = requireEmailAddress(account.user, account.config)
  await limitEmailRequest(request, account.config, address)
  return { message: await resendVerification(account) }
})
