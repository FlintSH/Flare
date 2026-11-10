/**
 * The background work of the owner's browser on the library
 * (docs/e2ee-spec.md, sections 8.3.4, 9.4.4, 9.7 and 9.8): one queue that
 * runs one job at a time, so the page stays responsive and two jobs never
 * race on the same records. A job can be asked for again while it runs. A
 * job that fails is tried again later, with a longer wait each time, and
 * is given up after a few attempts until something asks for it again.
 *
 * No server imports and no React: a provider starts it with the account
 * keys and stops it when they go.
 */

/** The jobs, in the order they run when several wait. */
export const MAINTENANCE_JOBS = [
  /** Seal the names and rules of tags from before encryption. */
  'tags',
  /** Folder keys, parent stanzas and folder stanzas of files. */
  'folders',
  /** Move account stanzas from old account keys to the current one. */
  'migration',
  /** Update the local cache of encrypted records for search. */
  'index',
  /** Thumbnails, text and tag rules of files that wait for a browser. */
  'pending',
] as const

export type MaintenanceJob = (typeof MAINTENANCE_JOBS)[number]

export interface MaintenanceProgress {
  /** What a person reads, for example "Reading text from images". */
  readonly label: string
  readonly done: number
  /** Null while the amount of work is not known. */
  readonly total: number | null
}

export interface MaintenanceState {
  readonly running: MaintenanceJob | null
  readonly progress: MaintenanceProgress | null
  readonly paused: boolean
  /** Jobs that failed their last attempts and wait for a new request. */
  readonly failed: readonly MaintenanceJob[]
}

export interface JobContext<Keys> {
  readonly keys: Keys
  /** Aborts when the keys go or the work stops. */
  readonly signal: AbortSignal
  report(progress: MaintenanceProgress): void
  /** Resolves at once, or when the work is resumed after a pause. */
  unpaused(): Promise<void>
}

export type JobRunner<Keys> = (context: JobContext<Keys>) => Promise<void>

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000]

const IDLE: MaintenanceState = {
  running: null,
  progress: null,
  paused: false,
  failed: [],
}

export interface MaintenanceOptions {
  /** Replaced in tests. */
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
  retryDelaysMs?: readonly number[]
}

export function createMaintenance<Keys>(
  runners: Partial<Record<MaintenanceJob, JobRunner<Keys>>>,
  options: MaintenanceOptions = {}
) {
  const setTimer =
    options.setTimer ?? ((run, ms) => globalThis.setTimeout(run, ms))
  const clearTimer =
    options.clearTimer ??
    ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>))
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS

  let state = IDLE
  const watchers = new Set<() => void>()
  const requested = new Set<MaintenanceJob>()
  const attempts = new Map<MaintenanceJob, number>()
  const timers = new Map<MaintenanceJob, unknown>()
  let keys: Keys | null = null
  let controller: AbortController | null = null
  let looping = false
  let resume: (() => void) | null = null

  const publish = (next: Partial<MaintenanceState>) => {
    state = { ...state, ...next }
    for (const watch of watchers) watch()
  }

  const unpaused = () =>
    state.paused
      ? new Promise<void>((resolve) => {
          const previous = resume
          resume = () => {
            previous?.()
            resolve()
          }
        })
      : Promise.resolve()

  async function loop() {
    if (looping) return
    looping = true
    try {
      for (;;) {
        const active = controller
        const held = keys
        if (!active || held === null || active.signal.aborted) return
        await unpaused()
        if (active.signal.aborted) return
        const job = MAINTENANCE_JOBS.find((name) => requested.has(name))
        if (!job) return
        requested.delete(job)
        const run = runners[job]
        if (!run) continue
        publish({
          running: job,
          progress: null,
          failed: state.failed.filter((name) => name !== job),
        })
        try {
          await run({
            keys: held,
            signal: active.signal,
            report: (progress) => {
              if (!active.signal.aborted) publish({ progress })
            },
            unpaused,
          })
          attempts.delete(job)
        } catch {
          if (active.signal.aborted) return
          const attempt = attempts.get(job) ?? 0
          if (attempt < delays.length) {
            attempts.set(job, attempt + 1)
            timers.set(
              job,
              setTimer(() => {
                timers.delete(job)
                request(job)
              }, delays[attempt])
            )
          } else {
            attempts.delete(job)
            publish({ failed: [...state.failed, job] })
          }
        } finally {
          if (controller === active) publish({ running: null, progress: null })
        }
      }
    } finally {
      looping = false
    }
  }

  /** Asks for a job. It runs after the jobs before it, and one time for many requests. */
  function request(...jobs: MaintenanceJob[]) {
    for (const job of jobs) requested.add(job)
    void loop()
  }

  return {
    subscribe(watch: () => void) {
      watchers.add(watch)
      return () => {
        watchers.delete(watch)
      }
    },
    getState: () => state,
    request,
    /** Starts with the keys of the unlocked account. Stops what ran for other keys. */
    start(nextKeys: Keys, jobs: readonly MaintenanceJob[] = MAINTENANCE_JOBS) {
      this.stop()
      keys = nextKeys
      controller = new AbortController()
      request(...jobs)
    },
    /** Stops the running job and forgets the queue: the keys are gone. */
    stop() {
      controller?.abort()
      controller = null
      keys = null
      requested.clear()
      attempts.clear()
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
      resume?.()
      resume = null
      state = IDLE
      for (const watch of watchers) watch()
    },
    pause() {
      if (!state.paused) publish({ paused: true })
    },
    resume() {
      if (!state.paused) return
      publish({ paused: false })
      const wake = resume
      resume = null
      wake?.()
    },
  }
}

export type Maintenance<Keys> = ReturnType<typeof createMaintenance<Keys>>
