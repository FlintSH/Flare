import { withAuditRoute } from '@/lib/audit'
import { securityRoute, securitySession } from '@/lib/auth/security/http'
import { SecurityError } from '@/lib/auth/security/shared'
import { revokeBrowserSessions } from '@/lib/auth/sessions'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(
    async () =>
      securityRoute(async () => {
        const { session } = await securitySession(req)
        const { id } = await params
        if (!id || id.length > 100)
          throw new SecurityError('Invalid session identifier.')
        return revokeBrowserSessions(session, id)
      }),
    { route: '/api/profile/sessions/[id]' }
  )(req)
}
