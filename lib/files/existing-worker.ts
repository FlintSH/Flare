import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import {
  claimFileEncryptions,
  processFileEncryption,
  pruneFinishedFileEncryptions,
} from './existing-encryption'

const logger = createLogger('file-encryption')

/**
 * Encrypts the existing files that their owners chose (docs/e2ee-spec.md,
 * section 14.2). Every app process can run it: leases are in the database,
 * and the limit on running jobs holds across processes. A lease that a
 * stopped process left is taken over on a later poll.
 */
export function startFileEncryptionWorker() {
  let polls = 0
  return startIntervalWorker({
    key: 'file-encryption',
    everyMs: 5_000,
    logger,
    failure:
      'The encryption of existing files is unavailable; retrying on the next poll.',
    run: async ({ runAgainIn }) => {
      const jobs = await claimFileEncryptions()
      if (!jobs.length) {
        // About one time per hour while the queue is empty.
        if (polls++ % 720 === 0) await pruneFinishedFileEncryptions()
        return
      }
      await Promise.allSettled(jobs.map((job) => processFileEncryption(job)))
      // A backlog continues without the wait for the next poll.
      runAgainIn(50)
    },
  })
}
