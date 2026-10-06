import { withAuditRoute } from '@/lib/audit'
import { securityRoute, securitySession } from '@/lib/auth/security/http'
import { listBrowserSessions, revokeBrowserSessions } from '@/lib/auth/sessions'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return withAuditRoute(
    async () =>
      securityRoute(async () => {
        const { session } = await securitySession(req, false)
        return listBrowserSessions(session)
      }),
    { route: '/api/profile/sessions' }
  )(req)
}

export async function DELETE(req: Request) {
  return withAuditRoute(
    async () =>
      securityRoute(async () => {
        const { session } = await securitySession(req)
        return revokeBrowserSessions(session)
      }),
    { route: '/api/profile/sessions' }
  )(req)
}
