import { createLogger } from '@/lib/logger'

import { claimStorageDeletions, processStorageDeletion } from './deletion'

const logger = createLogger('storage-cleanup')
const state = globalThis as typeof globalThis & {
  flareStorageDeletionWorker?: { timer: NodeJS.Timeout; busy: boolean }
}

/** Claims survive process shutdown; expired leases are recovered on later polls. */
export function startStorageDeletionWorker(): void {
  if (state.flareStorageDeletionWorker) return
  const timer = setInterval(async () => {
    const worker = state.flareStorageDeletionWorker
    if (!worker || worker.busy) return
    worker.busy = true
    try {
      const jobs = await claimStorageDeletions()
      const results = await Promise.allSettled(jobs.map(processStorageDeletion))
      if (
        results.some((result) => result.status === 'rejected' || !result.value)
      ) {
        logger.warn(
          'Account storage cleanup is pending; failed deletions will retry automatically.'
        )
      }
    } catch {
      // Provider/Prisma errors can contain credentials or query parameters.
      logger.warn('Storage cleanup is unavailable; retrying on the next poll.')
    } finally {
      worker.busy = false
    }
  }, 5_000)
  timer.unref()
  state.flareStorageDeletionWorker = { timer, busy: false }
}

export function stopStorageDeletionWorker(): void {
  if (!state.flareStorageDeletionWorker) return
  clearInterval(state.flareStorageDeletionWorker.timer)
  delete state.flareStorageDeletionWorker
}
