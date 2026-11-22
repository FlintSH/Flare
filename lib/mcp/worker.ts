import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { deleteExpiredTransfers } from './transfer'

const logger = createLogger('mcp-transfers')

/**
 * Removes transfer URLs that have expired. Making a new URL already clears
 * its credential's expired ones; this covers credentials that never come back.
 */
export function startTransferCleanupWorker() {
  return startIntervalWorker({
    key: 'mcp-transfer-cleanup',
    everyMs: 15 * 60_000,
    logger,
    failure: 'Transfer URL cleanup unavailable; retrying on the next run.',
    run: async () => {
      await deleteExpiredTransfers()
    },
  })
}
