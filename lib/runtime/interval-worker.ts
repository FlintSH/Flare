import { auditContext } from '@/lib/audit/context'
import type { Logger } from '@/lib/logger'

export interface IntervalWorker {
  /** Clears the worker's timers. A run already in progress finishes. */
  stop(): void
}

export interface IntervalWorkerOptions {
  /** Names the worker in this process. Starting a running key returns that worker. */
  key: string
  everyMs: number
  /** Delay before the first run. Without it, the first run waits one interval. */
  firstRunAfterMs?: number
  /** `runAgainIn(ms)` adds one extra run, for example to continue a backlog sooner. */
  run: (worker: { runAgainIn(ms: number): void }) => Promise<void> | void
  logger: Pick<Logger, 'warn'>
  /**
   * Logged when a run fails, without the error: database, storage and SMTP
   * errors can contain query parameters, credentials or message payloads.
   */
  failure: string
}

// One registry per process, shared by every route bundle that loads this module.
const registryKey = Symbol.for('flare.runtime.interval-workers')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const workers = (processState[registryKey] ??= new Map()) as Map<
  string,
  IntervalWorker
>

/**
 * Calls `run` every `everyMs` until stopped. Runs never overlap: a run that
 * comes due while the previous one is still going is skipped. A failed run is
 * logged and the next one goes ahead. The timers never keep the process alive.
 */
export function startIntervalWorker({
  key,
  everyMs,
  firstRunAfterMs,
  run,
  logger,
  failure,
}: IntervalWorkerOptions): IntervalWorker {
  const running = workers.get(key)
  if (running) return running

  const timeouts = new Set<NodeJS.Timeout>()
  let busy = false
  let stopped = false

  const tick = () =>
    // Timers inherit the async context of whoever started them, such as a
    // request, so each run starts a fresh one attributed to System.
    auditContext.run({ actorId: null, actorName: 'System' }, async () => {
      if (stopped || busy) return
      busy = true
      try {
        await run(controls)
      } catch {
        logger.warn(failure)
      } finally {
        busy = false
      }
    })

  const controls = {
    runAgainIn(ms: number) {
      if (stopped) return
      const timeout = setTimeout(() => {
        timeouts.delete(timeout)
        void tick()
      }, ms)
      timeout.unref()
      timeouts.add(timeout)
    },
  }

  const interval = setInterval(tick, everyMs)
  interval.unref()
  if (firstRunAfterMs !== undefined) controls.runAgainIn(firstRunAfterMs)

  const worker: IntervalWorker = {
    stop() {
      stopped = true
      clearInterval(interval)
      for (const timeout of timeouts) clearTimeout(timeout)
      timeouts.clear()
      if (workers.get(key) === worker) workers.delete(key)
    },
  }
  workers.set(key, worker)
  return worker
}
