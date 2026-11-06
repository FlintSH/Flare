import { z } from 'zod'

import { requestPasswordReset } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoutes } from '@/lib/email/http'
import { emailLinkAvailable } from '@/lib/email/links'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/request-reset', emailRoutes)

export const POST = api(async (request) => {
  const started = Date.now()
  try {
    const { email } = z
      .object({ email: z.string().trim().email().max(254) })
      .parse(await readJson(request))
    const config = await getEmailConfig()
    const message =
      'If this address is eligible for recovery, a password reset email will arrive shortly.'
    if (!emailLinkAvailable(config, 'reset')) return { message }
    await limitEmailRequest(request, config, email)
    // Delivery/admission failures must not reveal whether this address has an account.
    try {
      await requestPasswordReset(email, config)
    } catch {
      /* Generic response is intentional. */
    }
    return { message }
  } finally {
    // Include unknown addresses, disabled recovery and refusals in the same
    // response floor.
    const wait = 350 + Math.floor(Math.random() * 100) - (Date.now() - started)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
})
