import { securityRoutes, securitySession } from '@/lib/auth/security/http'
import { listLoginHistory } from '@/lib/auth/sessions'
import { routes } from '@/lib/http/route'

export const dynamic = 'force-dynamic'

const api = routes('/api/profile/login-history', securityRoutes)

export const GET = api(async (request) => {
  const { session } = await securitySession(request, false)
  const params = new URL(request.url).searchParams
  return listLoginHistory(
    session.user.id,
    params.get('outcome') || 'all',
    params.get('cursor') || undefined
  )
})
