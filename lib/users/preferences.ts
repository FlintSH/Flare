import type { Prisma } from '@prisma/client'
import type { InputJsonValue } from '@prisma/client/runtime/library'

import { lockRoleChanges, lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'

/** The parts of an account's preferences, each saved by its own setting. */
export type PreferencePart = 'customization' | 'embed' | 'tips'

/**
 * A caller's last word on a save of an account's own settings: run in the
 * saving transaction, once the role lock and the account's row are held and
 * before anything is written. It throws to refuse the save. What it reads of
 * roles and of the account cannot change before the commit.
 */
export type SaveCheck = (tx: Prisma.TransactionClient) => Promise<void>

/**
 * Saves one part of an account's preferences and leaves the others as they
 * are. The account row is locked, so two saves cannot drop each other's part.
 * `value` replaces the part, or, as a function, is handed the part as it
 * stands under the lock and answers what to save, so a change to some of it
 * keeps what another save wrote meanwhile. A `check` can refuse the save
 * under those locks. Answers what was saved.
 */
export async function savePreference(
  userId: string,
  part: PreferencePart,
  value: InputJsonValue | ((current: unknown) => InputJsonValue),
  check?: SaveCheck
): Promise<InputJsonValue> {
  return prisma.$transaction(async (tx) => {
    // The role lock goes before row locks, and a check reads roles.
    if (check) await lockRoleChanges(tx)
    await lockUserRow(tx, userId)
    await check?.(tx)
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferences: true },
    })
    const previous =
      user.preferences &&
      typeof user.preferences === 'object' &&
      !Array.isArray(user.preferences)
        ? user.preferences
        : {}
    const saved =
      typeof value === 'function'
        ? value((previous as Record<string, unknown>)[part])
        : value
    await tx.user.update({
      where: { id: userId },
      data: { preferences: { ...previous, [part]: saved } as InputJsonValue },
    })
    return saved
  })
}
