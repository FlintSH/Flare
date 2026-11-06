/**
 * Progress of the data exports this process is running, so the browser that
 * started one can follow it while it downloads. An export is known from the
 * moment it starts until it finishes or fails, and forgotten then. Another
 * app process keeps its own exports, so both requests of one export have to
 * reach the same process.
 */

type Watcher = {
  progress(percent: number): void
  end(finished: boolean): void
}

type RunningExport = {
  readonly files: number
  written: number
  readonly watchers: Set<Watcher>
}

type ExportProgress = {
  /** A stored file was added to the archive. */
  entryWritten(): void
  /** The download was read to the end. Followers see 100. */
  finished(): void
  /** The export failed, or its download was cancelled. */
  failed(): void
}

// One registry per process, whichever route bundle loads this module first.
const runningKey = Symbol.for('flare.users.running-exports')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const running = (processState[runningKey] ??= new Map()) as Map<
  string,
  RunningExport
>

// Owner and id together, so no account can follow another account's export.
const exportKey = (userId: string, exportId: string) => `${userId}\0${exportId}`

// 100 means the download was read to the end, not that every file is written.
const percent = ({ written, files }: RunningExport) =>
  files ? Math.min(99, Math.floor((written / files) * 100)) : 0

const untracked: ExportProgress = {
  entryWritten() {},
  finished() {},
  failed() {},
}

/**
 * Starts tracking an export of `files` stored files. An export started
 * without an id can't be followed, so it isn't tracked.
 */
export function trackExport(
  userId: string,
  exportId: string | null,
  files: number
): ExportProgress {
  if (exportId === null) return untracked
  const key = exportKey(userId, exportId)
  const entry: RunningExport = { files, written: 0, watchers: new Set() }
  running.set(key, entry)
  let settled = false
  const settle = (finished: boolean) => {
    if (settled) return
    settled = true
    // A later export that reused the id keeps its own progress.
    if (running.get(key) === entry) running.delete(key)
    for (const watcher of [...entry.watchers]) watcher.end(finished)
  }
  return {
    entryWritten() {
      if (settled) return
      entry.written++
      const progress = percent(entry)
      for (const watcher of entry.watchers) watcher.progress(progress)
    },
    finished: () => settle(true),
    failed: () => settle(false),
  }
}

/**
 * Proxies close a stream that stays silent, and one large file can take
 * minutes to read, so the current progress is repeated this often.
 */
const REPEAT_MS = 2_000

/**
 * Server-sent events for one of the account's running exports: `{ progress }`,
 * the percentage of its files written, on every change and every few
 * seconds, then 100 once the download has been read to the end. The stream
 * ends when the export finishes or fails or the client disconnects, and at
 * once when this process isn't running that export, as after it has ended.
 */
export function exportProgressEvents(
  userId: string,
  exportId: string,
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let stop = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const entry = running.get(exportKey(userId, exportId))
      if (!entry || signal.aborted) return controller.close()
      let sent = -1
      const send = (progress: number) => {
        sent = progress
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
        )
      }
      const close = () => {
        stop()
        controller.close()
      }
      const watcher: Watcher = {
        progress(progress) {
          if (progress !== sent) send(progress)
        },
        end(finished) {
          if (finished) send(100)
          close()
        },
      }
      const repeat = setInterval(() => send(sent), REPEAT_MS)
      stop = () => {
        clearInterval(repeat)
        entry.watchers.delete(watcher)
        signal.removeEventListener('abort', close)
      }
      entry.watchers.add(watcher)
      // A client that leaves before the response starts never cancels it.
      signal.addEventListener('abort', close, { once: true })
      send(percent(entry))
    },
    cancel: () => stop(),
  })
}
