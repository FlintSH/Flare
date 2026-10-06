import { withAuditRoute } from '@/lib/audit'
import { securityRoute, securitySession } from '@/lib/auth/security/http'
import { listLoginHistory } from '@/lib/auth/sessions'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return withAuditRoute(
    async () =>
      securityRoute(async () => {
        const { session } = await securitySession(req, false)
        const params = new URL(req.url).searchParams
        return listLoginHistory(
          session.user.id,
          params.get('outcome') || 'all',
          params.get('cursor') || undefined
        )
      }),
    { route: '/api/profile/login-history' }
  )(req)
}
