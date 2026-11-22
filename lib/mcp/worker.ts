import { createLogger } from '@/lib/logger'
import { cleanUpSignIn } from '@/lib/oauth/cleanup'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { deleteExpiredTransfers } from './transfer'

const logger = createLogger('mcp-transfers')

/**
 * Removes transfer URLs that have expired. Making a new URL already clears
 * its credential's expired ones; this covers credentials that never come back.
 * The same run removes what agent sign-in leaves behind: expired codes,
 * registrations nobody used, expired token pairs and ended connections.
 */
export function startTransferCleanupWorker() {
  return startIntervalWorker({
    key: 'mcp-transfer-cleanup',
    everyMs: 15 * 60_000,
    logger,
    failure: 'Transfer URL cleanup unavailable; retrying on the next run.',
    run: async () => {
      await deleteExpiredTransfers()
      try {
        await cleanUpSignIn()
      } catch {
        // Said on its own, and without the error, which can hold a query.
        logger.warn(
          'Agent sign-in cleanup unavailable; retrying on the next run.'
        )
      }
    },
  })
}
