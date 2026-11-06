import { securityRoutes, securitySession } from '@/lib/auth/security/http'
import { SecurityError } from '@/lib/auth/security/shared'
import { revokeBrowserSessions } from '@/lib/auth/sessions'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/profile/sessions/[id]', securityRoutes)

export const DELETE = api(async (request, { params }: Context) => {
  const { session } = await securitySession(request)
  const { id } = await params
  if (!id || id.length > 100)
    throw new SecurityError('Invalid session identifier.')
  return revokeBrowserSessions(session, id)
})
