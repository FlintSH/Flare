import { cancelEmailChange } from '@/lib/email/account'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/cancel-change', emailRoutes)

export const POST = api(async (request) => {
  const { user } = await emailSession(request)
  return { message: await cancelEmailChange(user.id) }
})
