import { cache } from 'react'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'

/**
 * Setup creates the first account, so any account means setup is done. Pass a
 * transaction to decide inside it. Database errors propagate: an instance
 * whose database can't be read is not a new instance.
 */
export async function isSetupComplete(
  db: Pick<Prisma.TransactionClient, 'user'> = prisma
): Promise<boolean> {
  return (await db.user.findFirst({ select: { id: true } })) !== null
}

/**
 * `isSetupComplete` for the page being rendered, read once per request.
 * Undefined while the database can't be read: unknown, not "not set up".
 */
export const pageSetupStatus = cache((): Promise<boolean | undefined> =>
  isSetupComplete().catch(() => undefined)
)
