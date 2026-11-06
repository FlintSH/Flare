import { z } from 'zod'

import { resetPassword } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoutes } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/reset', emailRoutes)

export const POST = api(async (request) => {
  const { token, password } = z
    .object({
      token: z.string().max(128),
      password: z
        .string()
        .min(8)
        .max(72)
        .refine(
          (value) => Buffer.byteLength(value, 'utf8') <= 72,
          'Password must use at most 72 bytes.'
        ),
    })
    .parse(await readJson(request))
  const config = await getEmailConfig()
  await limitEmailRequest(request, config)
  await resetPassword(token, password, config)
  return {
    message: 'Your password was changed. Sign in with your new password.',
  }
})
