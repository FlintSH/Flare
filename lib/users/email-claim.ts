import type { Prisma } from '@prisma/client'

import { lockEmailAddress } from '@/lib/database/locks'

type Lookup = Pick<Prisma.TransactionClient, 'user'>

/**
 * The same address in any letter case. Prisma compares insensitively with
 * ILIKE, so LIKE's `\`, `%` and `_` are escaped to stay literal characters.
 */
function sameAddress(email: string) {
  return {
    equals: email.trim().replace(/[\\%_]/g, (character) => `\\${character}`),
    mode: 'insensitive' as const,
  }
}

/**
 * The one account using an address in any letter case, or null when none or
 * several do: older accounts can hold addresses that differ only in letter
 * case, and such an address identifies nobody.
 */
export async function findAccountByEmail<Select extends Prisma.UserSelect>(
  db: Lookup,
  email: string,
  select: Select
) {
  const matches = await db.user.findMany({
    where: { email: sameAddress(email) },
    select,
    take: 2,
  })
  return matches.length === 1 ? matches[0] : null
}

/**
 * Holds a sign-in address until the transaction ends and says whether it is
 * free for `accountId` (or a new account): no other account may use it as
 * written, nor in any letter case while account email is enabled (`anyCase`).
 */
export async function claimEmail(
  tx: Prisma.TransactionClient,
  email: string,
  { accountId, anyCase }: { accountId?: string; anyCase: boolean }
) {
  await lockEmailAddress(tx, email)
  const holder = await tx.user.findFirst({
    where: {
      ...(accountId ? { id: { not: accountId } } : {}),
      email: anyCase ? sameAddress(email) : email,
    },
    select: { id: true },
  })
  return !holder
}
