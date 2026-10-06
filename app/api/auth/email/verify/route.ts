import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import { confirmEmailToken } from '@/lib/email/account'
import { getEmailConfig } from '@/lib/email/config'
import { emailRoute } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'

async function handlePOST(req: Request) {
  return emailRoute(async () => {
    const { token } = z
      .object({ token: z.string().max(128) })
      .parse(await req.json())
    const config = await getEmailConfig()
    await limitEmailRequest(req, config)
    return { message: await confirmEmailToken(token, config) }
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/email/verify',
  })(req)
}
