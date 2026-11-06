import { securityRoutes, securitySession } from '@/lib/auth/security/http'
import { listBrowserSessions, revokeBrowserSessions } from '@/lib/auth/sessions'
import { routes } from '@/lib/http/route'

export const dynamic = 'force-dynamic'

const api = routes('/api/profile/sessions', securityRoutes)

export const GET = api(async (request) => {
  const { session } = await securitySession(request, false)
  return listBrowserSessions(session)
})

export const DELETE = api(async (request) => {
  const { session } = await securitySession(request)
  return revokeBrowserSessions(session)
})
