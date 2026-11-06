import { z } from 'zod'

import {
  assertEmailChangesEnabled,
  requestEmailChange,
} from '@/lib/email/account'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/change', emailRoutes)

export const POST = api(async (request) => {
  const account = await emailSession(request)
  assertEmailChangesEnabled(account.config)
  const { email, password } = await readJson(
    request,
    z.object({
      email: z.string().trim().email().max(254),
      password: z.string().max(1024).optional(),
    })
  )
  await limitEmailRequest(request, account.config, email)
  return { message: await requestEmailChange(account, email, password) }
})
