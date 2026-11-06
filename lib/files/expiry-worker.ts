import { auditContext } from '@/lib/audit/context'
import { createLogger } from '@/lib/logger'

import { processDueExpirations, pruneFinishedExpirations } from './expiry'

const logger = createLogger('file-expiry')
const state = globalThis as typeof globalThis & {
  flareFileExpiryWorker?: {
    timer: NodeJS.Timeout
    busy: boolean
    pruneAt: number
  }
}

/** Every app process may run it: database claims apply each job once. */
export function startFileExpiryWorker(): void {
  if (state.flareFileExpiryWorker) return
  const timer = setInterval(
    () =>
      auditContext.run({ actorId: null, actorName: 'System' }, async () => {
        const worker = state.flareFileExpiryWorker
        if (!worker || worker.busy) return
        worker.busy = true
        try {
          await processDueExpirations()
          if (worker.pruneAt <= Date.now())
            worker.pruneAt = (await pruneFinishedExpirations())
              ? 0
              : Date.now() + 3_600_000
        } catch {
          // Prisma and storage errors can contain query parameters or credentials.
          logger.warn('File expiry is unavailable; retrying on the next poll.')
        } finally {
          worker.busy = false
        }
      }),
    5_000
  )
  timer.unref()
  state.flareFileExpiryWorker = { timer, busy: false, pruneAt: 0 }
}
