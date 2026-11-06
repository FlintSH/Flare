import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { processDueExpirations, pruneFinishedExpirations } from './expiry'

const logger = createLogger('file-expiry')

/** Every app process may run it: database claims apply each job once. */
export function startFileExpiryWorker() {
  let pruneAt = 0
  return startIntervalWorker({
    key: 'file-expiry',
    everyMs: 5_000,
    logger,
    failure: 'File expiry is unavailable; retrying on the next poll.',
    run: async () => {
      await processDueExpirations()
      if (pruneAt <= Date.now())
        pruneAt = (await pruneFinishedExpirations())
          ? 0
          : Date.now() + 3_600_000
    },
  })
}
