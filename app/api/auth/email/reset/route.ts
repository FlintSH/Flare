import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import { resetPassword } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoute } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'

async function handlePOST(req: Request) {
  return emailRoute(async () => {
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
      .parse(await req.json())
    const config = await getEmailConfig()
    await limitEmailRequest(req, config)
    await resetPassword(token, password, config)
    return {
      message: 'Your password was changed. Sign in with your new password.',
    }
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/email/reset',
  })(req)
}
