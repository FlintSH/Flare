import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { claimStorageDeletions, processStorageDeletion } from './deletion'

const logger = createLogger('storage-cleanup')

/** Claims survive process shutdown; expired leases are recovered on later polls. */
export function startStorageDeletionWorker() {
  return startIntervalWorker({
    key: 'storage-deletion',
    everyMs: 5_000,
    logger,
    failure: 'Storage cleanup is unavailable; retrying on the next poll.',
    run: async () => {
      const jobs = await claimStorageDeletions()
      const results = await Promise.allSettled(jobs.map(processStorageDeletion))
      if (
        results.some((result) => result.status === 'rejected' || !result.value)
      ) {
        logger.warn(
          'Account storage cleanup is pending; failed deletions will retry automatically.'
        )
      }
    },
  })
}
