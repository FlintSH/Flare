import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
import type { RoleSummary } from '@/lib/permissions/catalog'
import { EVERYONE_ROLE } from '@/lib/permissions/policy'
import {
  type UserAccess,
  combineAccess,
  roleSelect,
} from '@/lib/permissions/server'
import { oncePerRequest } from '@/lib/runtime/request-scope'

/** What authenticating a request reads about its account. */
export const accountSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  sessionVersion: true,
  passkeyRequired: true,
  emailVerified: true,
  emailVerifiedFor: true,
  emailVerificationSource: true,
  emailExempt: true,
  createdAt: true,
  storageUsed: true,
  urlId: true,
  vanityId: true,
  randomizeFileUrls: true,
  roles: { select: roleSelect },
} satisfies Prisma.UserSelect

type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>

export type Account = Omit<AccountRow, 'roles'> & {
  access: UserAccess
  /** The account must verify its email address before it may use Flare. */
  emailAccessRequired: boolean
}

/**
 * What every account's access also depends on: the role everyone holds and
 * the email policy. Start it beside the read of the account's own row.
 */
export function accountPolicy(): Promise<[RoleSummary | null, EmailConfig]> {
  return Promise.all([
    prisma.role.findUnique({
      where: { systemKey: EVERYONE_ROLE },
      select: roleSelect,
    }),
    getEmailConfig(),
  ])
}

export function accountFrom(
  { roles, ...user }: AccountRow,
  [everyone, emailConfig]: Awaited<ReturnType<typeof accountPolicy>>
): Account {
  return {
    ...user,
    access: combineAccess(roles, everyone),
    emailAccessRequired: requiresEmailVerification(user, emailConfig),
  }
}

/** An account with its roles and email standing, read together. */
export async function loadAccount(
  where: Prisma.UserWhereUniqueInput
): Promise<Account | null> {
  const [user, policy] = await Promise.all([
    prisma.user.findUnique({ where, select: accountSelect }),
    accountPolicy(),
  ])
  return user && accountFrom(user, policy)
}

/**
 * The account a browser session belongs to, read once for each request: the
 * session's token, its permissions and the route's own check all use the same
 * rows. A route that must see a change it just made reads the database itself.
 */
export function sessionAccount(userId: string): Promise<Account | null> {
  return oncePerRequest(`account:${userId}`, () => loadAccount({ id: userId }))
}
