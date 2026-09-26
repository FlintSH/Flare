import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'

import type { Permission } from './catalog'
import {
  assertAccessibleAdministrator,
  assertCanManageUser,
  lockRoleChanges,
  requireActorPermission,
} from './server'

/** Account administration shares one lock with role and email-policy changes. */
export async function mutateAccount<T>(
  actorId: string,
  targetId: string,
  permission: Permission,
  mutation: (tx: Prisma.TransactionClient) => Promise<T>,
  self = false
) {
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, actorId, permission)
    if (!self) await assertCanManageUser(tx, actorId, targetId)
    const result = await mutation(tx)
    await assertAccessibleAdministrator(tx)
    return result
  })
}
