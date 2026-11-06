import type { User } from '@prisma/client'
import { type Session, getServerSession } from 'next-auth'

import { authOptions, getAccessSession } from '@/lib/auth'
import {
  type AuthenticatedUser,
  getAuthenticatedUser,
} from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { requestPermissions } from '@/lib/integrations/bearer-routes'
import {
  type Permission,
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'

import { AccessError } from './errors'
import { assertBrowserWrite } from './request'

/**
 * The account behind a browser session, the legacy upload token or a named
 * token. The permissions come from the bearer route table, which fails closed
 * for routes it doesn't list. A write the session authenticates must come from
 * Flare's own pages; token requests are never origin-checked.
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
  if (user.credential === 'session') assertBrowserWrite(request)
  return user
}

type SessionOptions = {
  /** Accounts that must verify their email address first may continue. */
  pendingEmail?: boolean
  /** Refuse an Authorization header, even beside the session cookie. */
  refuseApiCredentials?: boolean
  /**
   * Also read the account's row, refusing a session whose account is gone or
   * was signed out everywhere since the session was issued.
   */
  fresh?: boolean
}

type SessionAccess = { session: Session; user: Session['user'] }

/**
 * The browser session; API tokens never authorize these routes. Pass a
 * permission to require it, or several to require any one of them. Writes
 * must come from Flare's own pages.
 */
export async function requireSession(
  request: Request,
  permission?: Permission | readonly Permission[],
  options?: SessionOptions & { fresh?: false }
): Promise<SessionAccess>
export async function requireSession(
  request: Request,
  permission: Permission | readonly Permission[] | undefined,
  options: SessionOptions & { fresh: true }
): Promise<SessionAccess & { account: User }>
export async function requireSession(
  request: Request,
  permission?: Permission | readonly Permission[],
  options: SessionOptions = {}
): Promise<SessionAccess & { account?: User }> {
  if (options.refuseApiCredentials) refuseApiCredentials(request)
  const session = options.pendingEmail
    ? await getServerSession(authOptions)
    : await getAccessSession()
  if (!session?.user) throw new AccessError(401, 'Authentication required')
  let account: User | undefined
  if (options.fresh) {
    const row = await prisma.user.findUnique({
      where: { id: session.user.id },
    })
    if (!row || row.sessionVersion !== session.user.sessionVersion)
      throw new AccessError(401, 'Sign in again to continue.')
    account = row
  }
  if (permission !== undefined) assertPermission(session.user, permission)
  assertBrowserWrite(request)
  return { session, user: session.user, account }
}

/** Refuses a signed-in user who holds none of these permissions. */
export function assertPermission(
  user: PermissionSubject,
  permission: Permission | readonly Permission[]
) {
  const anyOf = typeof permission === 'string' ? [permission] : permission
  if (
    anyOf.length &&
    !anyOf.some((candidate) => hasPermission(user, candidate))
  )
    throw new AccessError(403, 'Permission denied')
}

/** Routes only Flare's pages call refuse API credentials, even beside a cookie. */
export function refuseApiCredentials(request: Request) {
  if (request.headers.has('authorization'))
    throw new AccessError(401, 'API credentials cannot authorize this request.')
}
