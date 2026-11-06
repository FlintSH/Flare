import { z } from 'zod'

import { resetPassword } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoutes } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { accountPasswordSchema } from '@/lib/users/account-policy'

const api = routes('/api/auth/email/reset', emailRoutes)

export const POST = api(async (request) => {
  const { token, password } = await readJson(
    request,
    z.object({
      token: z.string().max(128),
      password: accountPasswordSchema,
    })
  )
  const config = await getEmailConfig()
  await limitEmailRequest(request, config)
  await resetPassword(token, password, config)
  return {
    message: 'Your password was changed. Sign in with your new password.',
  }
})
