import { getAccessSession } from '@/lib/auth'
import {
  type AuthenticatedUser,
  getAuthenticatedUser,
} from '@/lib/auth/api-auth'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import { requestPermissions } from '@/lib/permissions/requests'

import { AccessError } from './errors'

/**
 * The account behind a browser session, the legacy upload token or a named
 * token. The permissions come from the bearer route table, which fails closed
 * for routes it doesn't list.
 */
export async function requireAccount(
  request: Request
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(request)
  if (!user) throw new AccessError(401, 'Unauthorized')
  const required = requestPermissions(
    request.method,
    new URL(request.url).pathname
  )
  if (
    !required ||
    required.some((permission) => !hasPermission(user, permission))
  )
    throw new AccessError(
      403,
      'You do not have permission to perform this action.'
    )
  return user
}

/**
 * The browser session; API tokens never authorize these routes. Pass a
 * permission to require it, or several to require any one of them.
 */
export async function requireSession(
  permission?: Permission | readonly Permission[]
) {
  const session = await getAccessSession()
  if (!session?.user) throw new AccessError(401, 'Authentication required')
  const anyOf =
    permission === undefined
      ? []
      : typeof permission === 'string'
        ? [permission]
        : permission
  if (
    anyOf.length &&
    !anyOf.some((candidate) => hasPermission(session.user, candidate))
  )
    throw new AccessError(403, 'Permission denied')
  return { session, user: session.user }
}
