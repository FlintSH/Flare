import type { StorageProvider } from '@/lib/storage'

import { ArchiveIndex } from './archive-index'
import { type ByteSource, openByteSource } from './byte-source'
import { ArchiveError } from './errors'
import { GzipSeekIndex, inflateIndexed } from './gzip-reader'
import {
  ARCHIVE_BROWSE_LIMITS,
  type ArchiveFormat,
  archiveBasename,
} from './shared'
import {
  ChunkTarInput,
  type ScanContext,
  ScanLimitReached,
  SourceTarInput,
  scanTar,
} from './tar-reader'
import { indexZip } from './zip-reader'

/** Identifies one stored archive and how to read it. */
export interface ArchiveSourceRef {
  /** Changes whenever the record, its bytes, or its interpretation change. */
  key: string
  storage: StorageProvider
  path: string
  /** Name with a recognizable archive extension. */
  name: string
  format: ArchiveFormat
}

/** Approximate memory kept for finished indexes in each process. */
export const ARCHIVE_INDEX_CACHE_BYTES = 128 * 1024 ** 2
/** Indexes being built at once per process; more wait in a short queue. */
export const ARCHIVE_INDEX_CONCURRENCY = 2
const QUEUED_INDEXES = 32
/** Stop an unfinished index nobody has asked about recently. */
const ABANDONED_MS = 30_000

class IndexJob {
  readonly controller = new AbortController()
  index: ArchiveIndex | null = null
  promise!: Promise<ArchiveIndex>
  settled = false
  error: unknown = null
  lastSeen = Date.now()
  waiters = 0

  constructor(readonly ref: ArchiveSourceRef) {}
}

interface CacheState {
  ready: Map<string, { index: ArchiveIndex; bytes: number }>
  bytes: number
  jobs: Map<string, IndexJob>
  running: number
  queue: Array<{ start: () => void; signal: AbortSignal }>
}

const stateKey = Symbol.for('flare.archive.index-cache')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const state = (processState[stateKey] ??= {
  ready: new Map(),
  bytes: 0,
  jobs: new Map(),
  running: 0,
  queue: [],
}) as CacheState

export function clearArchiveIndexCache() {
  for (const job of state.jobs.values())
    job.controller.abort(new ArchiveError('Archive cache cleared.', 503))
  state.ready.clear()
  state.bytes = 0
}

function remember(key: string, index: ArchiveIndex) {
  const bytes = index.memoryBytes
  for (const [oldKey, old] of state.ready) {
    if (state.bytes + bytes <= ARCHIVE_INDEX_CACHE_BYTES) break
    state.ready.delete(oldKey)
    state.bytes -= old.bytes
  }
  state.ready.set(key, { index, bytes })
  state.bytes += bytes
}

async function acquireSlot(signal: AbortSignal) {
  signal.throwIfAborted()
  if (state.running < ARCHIVE_INDEX_CONCURRENCY) {
    state.running++
    return
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      signal,
      start: () => {
        signal.removeEventListener('abort', cancel)
        resolve()
      },
    }
    const cancel = () => {
      state.queue = state.queue.filter((item) => item !== waiter)
      reject(signal.reason)
    }
    signal.addEventListener('abort', cancel, { once: true })
    state.queue.push(waiter)
  })
}

function releaseSlot() {
  const next = state.queue.shift()
  if (next) next.start()
  else state.running--
}

export async function buildArchiveIndex(
  source: ByteSource,
  index: ArchiveIndex,
  name: string,
  signal: AbortSignal
) {
  const deadline = Date.now() + ARCHIVE_BROWSE_LIMITS.scanMs
  const context: ScanContext = {
    signal,
    maxEntries: ARCHIVE_BROWSE_LIMITS.entries,
    tick() {
      if (Date.now() > deadline) throw new ScanLimitReached('time')
    },
  }
  if (index.format === 'zip')
    return indexZip(source, index, {
      entries: ARCHIVE_BROWSE_LIMITS.entries,
      directoryBytes: ARCHIVE_BROWSE_LIMITS.centralDirectoryBytes,
    })
  if (index.format === 'tar')
    return scanTar(new SourceTarInput(source, index), index, context)
  if (!source.size)
    throw new ArchiveError('This compressed file is empty or incomplete.')
  index.gzip = new GzipSeekIndex()
  const decoded = inflateIndexed(
    await source.stream(0, source.size),
    index.gzip,
    {
      consumed(bytes) {
        index.bytesRead = bytes
      },
      tick(output) {
        signal.throwIfAborted()
        context.tick()
        if (output > ARCHIVE_BROWSE_LIMITS.scanBytes)
          throw new ScanLimitReached('size')
      },
    }
  )
  if (index.format === 'tar.gz') {
    const input = new ChunkTarInput(decoded)
    try {
      await scanTar(input, index, context)
    } finally {
      await input.close()
    }
    return
  }
  // A GZIP holds one file; its name follows the archive, as on extraction.
  let size = 0
  let issue: 'damaged' | undefined
  try {
    for await (const chunk of decoded) size += chunk.length
  } catch (error) {
    if (error instanceof ScanLimitReached) index.truncated = error.reason
    else if (error instanceof ArchiveError && size && !signal.aborted) {
      index.truncated = 'damaged'
      issue = 'damaged'
    } else throw error
  }
  index.add({
    path: archiveBasename(name),
    type: 'file',
    size,
    ...(issue ? { issue } : {}),
    offset: 0,
  })
}

async function runJob(job: IndexJob) {
  const { signal } = job.controller
  await acquireSlot(signal)
  try {
    const source = await openByteSource(job.ref.storage, job.ref.path, {
      signal,
    })
    try {
      const index = new ArchiveIndex(job.ref.format, source.size)
      job.index = index
      await buildArchiveIndex(source, index, job.ref.name, signal)
      signal.throwIfAborted()
      index.complete = true
      return index
    } finally {
      await source.close().catch(() => {})
    }
  } finally {
    releaseSlot()
  }
}

function startJob(ref: ArchiveSourceRef) {
  if (state.jobs.size >= ARCHIVE_INDEX_CONCURRENCY + QUEUED_INDEXES)
    throw new ArchiveError(
      'Flare is reading several archives right now. Try again shortly.',
      429
    )
  const job = new IndexJob(ref)
  state.jobs.set(ref.key, job)
  const watchdog = setInterval(() => {
    if (!job.waiters && Date.now() - job.lastSeen > ABANDONED_MS)
      job.controller.abort(
        new ArchiveError('Nobody is waiting for this archive anymore.', 408)
      )
  }, 5_000)
  watchdog.unref?.()
  job.promise = runJob(job)
    .then(
      (index) => {
        remember(ref.key, index)
        return index
      },
      (error) => {
        job.error = job.controller.signal.aborted
          ? job.controller.signal.reason
          : error
        throw job.error
      }
    )
    .finally(() => {
      job.settled = true
      clearInterval(watchdog)
      if (state.jobs.get(ref.key) === job) state.jobs.delete(ref.key)
    })
  job.promise.catch(() => {})
  return job
}

function settleWithin(
  promise: Promise<unknown>,
  wait: number | 'complete',
  signal: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    const timer =
      wait === 'complete' ? null : setTimeout(done, Math.max(0, wait))
    function done() {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      if (timer) clearTimeout(timer)
      reject(signal.reason)
    }
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(done, done)
  })
}

export interface ArchiveIndexView {
  /** Null while the job is still queued. */
  index: ArchiveIndex | null
  complete: boolean
  /** True when the finished index was already in memory. */
  cached: boolean
}

/**
 * Return the archive index, starting or joining the one shared job that builds
 * it. With a numeric `wait`, a partial index is returned after that many ms.
 */
export async function getArchiveIndex(
  ref: ArchiveSourceRef,
  options: { signal: AbortSignal; wait: number | 'complete' }
): Promise<ArchiveIndexView> {
  const ready = state.ready.get(ref.key)
  if (ready) {
    // Refresh recency; Map iteration order doubles as the LRU order.
    state.ready.delete(ref.key)
    state.ready.set(ref.key, ready)
    return { index: ready.index, complete: true, cached: true }
  }
  const job = state.jobs.get(ref.key) ?? startJob(ref)
  job.lastSeen = Date.now()
  job.waiters++
  try {
    await settleWithin(job.promise, options.wait, options.signal)
  } finally {
    job.waiters--
    job.lastSeen = Date.now()
  }
  if (job.error) throw job.error
  return { index: job.index, complete: job.settled, cached: false }
}

/** A file entry by exact path, or by its position in the listing. */
export type ArchiveEntrySelector = { path: string } | { position: number }

function select(index: ArchiveIndex | null, selector: ArchiveEntrySelector) {
  if (!index) return undefined
  if ('path' in selector) return index.find(selector.path)
  const entry = index.entries[selector.position]
  return entry?.type === 'file' ? entry : undefined
}

/** Find a file entry, waiting for more of the index only when necessary. */
export async function findArchiveEntry(
  ref: ArchiveSourceRef,
  selector: ArchiveEntrySelector,
  signal: AbortSignal
) {
  let view = await getArchiveIndex(ref, { signal, wait: 0 })
  let entry = select(view.index, selector)
  if (!entry && !view.complete) {
    view = await getArchiveIndex(ref, { signal, wait: 'complete' })
    entry = select(view.index, selector)
  }
  if (!entry || !view.index)
    throw new ArchiveError('Archive entry not found.', 404)
  return { index: view.index, entry, view }
}
