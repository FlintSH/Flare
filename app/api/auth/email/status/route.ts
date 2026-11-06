import { getConfig } from '@/lib/config'
import { accountEmailStatus } from '@/lib/email/eligibility'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/status', emailRoutes)

export const GET = api(async () => {
  const { user, config } = await emailSession()
  return accountEmailStatus(
    user,
    config,
    (await getConfig()).settings.general.oidc
  )
})
