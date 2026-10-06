import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import { requestPasswordReset } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoute } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'

async function handlePOST(req: Request) {
  const started = Date.now()
  const response = await emailRoute(async () => {
    const { email } = z
      .object({ email: z.string().trim().email().max(254) })
      .parse(await req.json())
    const config = await getEmailConfig()
    const message =
      'If this address is eligible for recovery, a password reset email will arrive shortly.'
    if (!config.enabled || !config.recovery.enabled) return { message }
    await limitEmailRequest(req, config, email)
    // Delivery/admission failures must not reveal whether this address has an account.
    try {
      await requestPasswordReset(email, config)
    } catch {
      /* Generic response is intentional. */
    }
    return { message }
  })
  // Include unknown addresses and disabled recovery in the same response floor.
  const wait = 350 + Math.floor(Math.random() * 100) - (Date.now() - started)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  return response
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/email/request-reset',
  })(req)
}
