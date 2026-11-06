import { recordCascadedDeletes } from '@/lib/audit'
import { lockUserRow } from '@/lib/database/locks'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { queueAccountFileDeletions } from '@/lib/storage/deletion'

import { queueAvatarDeletion } from './avatar'

/** Account deletion's transaction budget: a large library is queued in bulk. */
export const ACCOUNT_DELETION_TRANSACTION_MS = 120_000

/**
 * Deletes an account and everything the database deletes with it. The same
 * transaction queues the bytes of its files and uploaded avatar for the
 * storage deletion worker and records a delete event for every file and invite
 * link that goes, so a refusal, such as deleting the last administrator, rolls
 * all of it back.
 */
export async function deleteAccount(
  actorId: string,
  targetId: string,
  permission: 'profile.update' | 'users.delete',
  self = false
) {
  await mutateAccount(
    actorId,
    targetId,
    permission,
    async (tx) => {
      // File publication and account mutation share this row lock. Read the
      // paths now, rather than keeping a snapshot from before access was
      // serialized.
      await lockUserRow(tx, targetId)
      const user = await tx.user.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          image: true,
          avatarStoragePath: true,
          avatarStorageTarget: true,
        },
      })
      if (!user) throw new PermissionError('Account not found', 404)
      await queueAccountFileDeletions(tx, targetId)
      await queueAvatarDeletion(tx, user)
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { name: true },
      })
      const deletion = {
        actorId,
        actorName: actor?.name ?? actorId,
        reason: 'Account deleted',
      }
      // Database cascades bypass the Prisma audit extension, so every
      // filename is recorded here, in the same transaction.
      await recordCascadedDeletes(tx, 'File', {
        ...deletion,
        where: { userId: targetId },
        name: 'name',
        copy: { ownerId: 'userId' },
      })
      // The account's invite links cascade too; accounts that joined remain.
      await recordCascadedDeletes(tx, 'Invite', {
        ...deletion,
        where: { creatorId: targetId },
        name: 'note',
        copy: { creatorId: 'creatorId', uses: 'uses' },
      })
      await tx.user.delete({ where: { id: targetId } })
    },
    self,
    { timeout: ACCOUNT_DELETION_TRANSACTION_MS }
  )
}
