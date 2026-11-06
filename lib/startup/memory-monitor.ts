import { loggers } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

const logger = loggers.startup
const HEAP_WARNING_BYTES = 1024 * 1024 * 1024

const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024) + 'MB'

export function startMemoryMonitor() {
  return startIntervalWorker({
    key: 'memory-monitor',
    everyMs: 60_000,
    logger,
    failure: 'Memory monitor unavailable; retrying on the next poll.',
    run: () => {
      const usage = process.memoryUsage()
      if (usage.heapUsed > HEAP_WARNING_BYTES)
        logger.warn('High memory usage detected', {
          heapUsed: megabytes(usage.heapUsed),
          heapTotal: megabytes(usage.heapTotal),
          external: megabytes(usage.external),
        })
    },
  })
}
