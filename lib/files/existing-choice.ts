import { z } from 'zod'

import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'

import {
  EXISTING_FILES_CHOICES,
  type ExistingFilesChoice,
  cancelWaitingFileEncryption,
  enqueueFileEncryption,
  existingFilesStatus,
} from './existing-encryption'

/**
 * What the owner decides about the files from before end-to-end encryption
 * (docs/e2ee-spec.md, section 14.2). Only a session of the owner reaches
 * these functions: the job needs the choice of that person, and no
 * administrator and no API token makes it for them.
 */

export const existingFilesChoiceSchema = z.strictObject({
  choice: z.enum(EXISTING_FILES_CHOICES),
})

/** The most files one request queues. A larger selection is sent in parts. */
export const ENCRYPT_FILES_LIMIT = 500

export const encryptFilesSchema = z.strictObject({
  fileIds: z.array(z.string().min(1).max(128)).min(1).max(ENCRYPT_FILES_LIMIT),
})

async function requireKeys(tx: Pick<typeof prisma, 'user'>, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { accountPublicKey: true },
  })
  if (!user) throw new HttpError(401, 'Account no longer exists.')
  if (!user.accountPublicKey)
    throw new HttpError(
      409,
      'Set up your encryption keys before encrypting files.',
      { body: { code: 'account_keys_missing' } }
    )
}

/**
 * Records the answer and queues the files it covers. A new answer replaces
 * the jobs that wait: `none` leaves nothing queued, and a file that is being
 * encrypted at this moment is finished.
 */
export async function chooseExistingFiles(
  userId: string,
  choice: ExistingFilesChoice
) {
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    await requireKeys(tx, userId)
    await tx.user.update({
      where: { id: userId },
      data: { existingFilesChoice: choice, existingFilesChoiceAt: new Date() },
    })
    await cancelWaitingFileEncryption(tx, userId)
    if (choice !== 'none')
      await enqueueFileEncryption(tx, userId, { scope: choice })
  })
  return existingFilesStatus(userId)
}

/** Queues plain files that the owner selected in the library. Other IDs are left out. */
export async function requestFileEncryption(userId: string, fileIds: string[]) {
  const queued = await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    await requireKeys(tx, userId)
    return enqueueFileEncryption(tx, userId, {
      fileIds: [...new Set(fileIds)],
    })
  })
  return { queued }
}
