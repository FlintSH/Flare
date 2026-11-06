import { z } from 'zod'

import { enrollEmail, requireEmailAddress } from '@/lib/email/account'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/enroll', emailRoutes)

export const POST = api(async (request) => {
  const account = await emailSession(request)
  const address = requireEmailAddress(account.user, account.config)
  const { password } = await readJson(
    request,
    z.object({ password: z.string().max(1024).optional() })
  )
  await limitEmailRequest(request, account.config, address)
  return { message: await enrollEmail(account, password) }
})
