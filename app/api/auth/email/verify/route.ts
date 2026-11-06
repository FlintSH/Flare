import { z } from 'zod'

import { confirmEmailToken } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoutes } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/verify', emailRoutes)

export const POST = api(async (request) => {
  const { token } = await readJson(
    request,
    z.object({ token: z.string().max(128) })
  )
  const config = await getEmailConfig()
  await limitEmailRequest(request, config)
  return { message: await confirmEmailToken(token, config) }
})
