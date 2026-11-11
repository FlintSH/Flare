import type { EncryptedRecordsWire } from '@/lib/e2ee/client/files'

import {
  type IndexedFile,
  type IndexedRow,
  type OrderedEntry,
  type ViewQuery,
  indexedFile,
  queryIndex,
} from './search-core'

/**
 * The local search index of the owner's encrypted files (docs/e2ee-spec.md,
 * section 9.8): a cache of encrypted records, updated in steps, and their
 * plaintext in memory.
 *
 * - The store holds exactly what the server sent: the header, the sealed
 *   name and type, the account stanza and the sealed image text of each
 *   file, with the values a list row shows. Nothing decrypted goes in.
 * - The names, types and text are opened into memory for the session.
 * - An update asks for the records after the last sequence number it saw.
 *   The answer's count and sum of sequence numbers show a cache that
 *   missed a change or a deleted file, and the cache then repairs itself
 *   from the list of every file's number.
 *
 * No browser APIs here: a worker supplies the store, the requests and the
 * keys, and a test supplies them in memory.
 */

/** One record as the sync endpoint sends it and as the cache keeps it. */
export interface CachedRecord extends IndexedRow {
  readonly seq: number
  readonly encryption?: EncryptedRecordsWire | null
  readonly sealedOcrText: string | null
}

/** Where the encrypted records are kept between sessions. */
export interface RecordStore {
  /** Whether the records outlive the page. */
  readonly persistent: boolean
  load(): Promise<CachedRecord[]>
  put(records: readonly CachedRecord[]): Promise<void>
  remove(ids: readonly string[]): Promise<void>
  clear(): Promise<void>
}

/** A store in memory: for a browser without OPFS, and for tests. */
export function createMemoryStore(
  initial: readonly CachedRecord[] = []
): RecordStore & { readonly records: Map<string, CachedRecord> } {
  const records = new Map(initial.map((record) => [record.id, record]))
  return {
    persistent: false,
    records,
    async load() {
      return [...records.values()]
    },
    async put(changed) {
      for (const record of changed) records.set(record.id, record)
    },
    async remove(ids) {
      for (const id of ids) records.delete(id)
    },
    async clear() {
      records.clear()
    },
  }
}

export interface SyncApi {
  changes(since: number): Promise<{
    records: CachedRecord[]
    more: boolean
    state: { count: number; sum: string }
  }>
  index(after?: string): Promise<{
    entries: (readonly [string, number])[]
    more: boolean
  }>
  byIds(ids: string[]): Promise<{ records: CachedRecord[] }>
}

export interface IndexProgress {
  /** `loading`: reading the cache. `syncing`: asking the server. `ready`: up to date. */
  readonly status: 'loading' | 'syncing' | 'ready'
  /** Files whose name is in memory. */
  readonly indexed: number
  /** Records known so far. */
  readonly total: number
}

export interface SearchIndexDeps {
  store: RecordStore
  api: SyncApi
  /** Opens the name, the type and the text of one record. Null when no key opens it. */
  open(
    record: CachedRecord
  ): Promise<{ name: string; type: string; text: string | null } | null>
  onProgress?(progress: IndexProgress): void
  signal?: AbortSignal
}

const OPEN_BATCH = 200
const ID_BATCH = 100

export function createSearchIndex(deps: SearchIndexDeps) {
  /** Every record of the cache, also one that no key opened. */
  const cached = new Map<string, CachedRecord>()
  /** The files whose plaintext is in memory. */
  const files = new Map<string, IndexedFile<CachedRecord>>()
  let status: IndexProgress['status'] = 'loading'
  let version = 0

  const report = () =>
    deps.onProgress?.({ status, indexed: files.size, total: cached.size })

  async function open(records: readonly CachedRecord[]) {
    for (let start = 0; start < records.length; start += OPEN_BATCH) {
      deps.signal?.throwIfAborted()
      const batch = records.slice(start, start + OPEN_BATCH)
      const opened = await Promise.all(
        batch.map((record) => deps.open(record).catch(() => null))
      )
      batch.forEach((record, index) => {
        cached.set(record.id, record)
        const plain = opened[index]
        if (plain) files.set(record.id, indexedFile(record, plain))
        else files.delete(record.id)
      })
      version++
      report()
    }
  }

  function digest() {
    let sum = BigInt(0)
    for (const record of cached.values()) sum += BigInt(record.seq)
    return { count: cached.size, sum: sum.toString() }
  }

  function forget(ids: readonly string[]) {
    for (const id of ids) {
      cached.delete(id)
      files.delete(id)
    }
    if (ids.length) version++
  }

  /** The cache does not match the server: find what differs and fix only that. */
  async function repair() {
    const server = new Map<string, number>()
    let after: string | undefined
    for (;;) {
      deps.signal?.throwIfAborted()
      const page = await deps.api.index(after)
      for (const [id, seq] of page.entries) server.set(id, seq)
      if (!page.more || !page.entries.length) break
      after = page.entries[page.entries.length - 1][0]
    }
    const gone = [...cached.keys()].filter((id) => !server.has(id))
    if (gone.length) {
      await deps.store.remove(gone)
      forget(gone)
    }
    const stale = [...server].flatMap(([id, seq]) =>
      cached.get(id)?.seq === seq ? [] : [id]
    )
    for (let start = 0; start < stale.length; start += ID_BATCH) {
      deps.signal?.throwIfAborted()
      const { records } = await deps.api.byIds(
        stale.slice(start, start + ID_BATCH)
      )
      await deps.store.put(records)
      await open(records)
    }
  }

  let working: Promise<void> = Promise.resolve()
  /** One load or update at a time. */
  const exclusive = (work: () => Promise<void>) => {
    const next = working.then(work, work)
    working = next.catch(() => undefined)
    return next
  }

  return {
    /** Reads the cache and opens it into memory. */
    load: () =>
      exclusive(async () => {
        status = 'loading'
        report()
        await open(await deps.store.load())
      }),

    /** Asks the server for what changed, and repairs the cache if it missed something. */
    sync: () =>
      exclusive(async () => {
        status = 'syncing'
        report()
        let cursor = 0
        for (const record of cached.values())
          cursor = Math.max(cursor, record.seq)
        for (;;) {
          deps.signal?.throwIfAborted()
          const page = await deps.api.changes(cursor)
          if (page.records.length) {
            await deps.store.put(page.records)
            await open(page.records)
            for (const record of page.records)
              cursor = Math.max(cursor, record.seq)
          }
          if (page.more && page.records.length) continue
          const local = digest()
          if (local.count !== page.state.count || local.sum !== page.state.sum)
            await repair()
          break
        }
        status = 'ready'
        version++
        report()
      }),

    /** A file this browser deleted: out of the cache at once. */
    drop: (ids: readonly string[]) =>
      exclusive(async () => {
        await deps.store.remove(ids)
        forget(ids)
        report()
      }),

    /** Erases the cache and the plaintext: the session ended. */
    clear: () =>
      exclusive(async () => {
        await deps.store.clear()
        cached.clear()
        files.clear()
        version++
      }),

    query: (query: ViewQuery): OrderedEntry[] =>
      queryIndex(files.values(), query),
    rows: (ids: readonly string[]): CachedRecord[] =>
      ids.flatMap((id) => {
        const file = files.get(id)
        return file ? [file.row] : []
      }),
    /** Every type that an opened file has, for the type filter. */
    types: (): string[] =>
      [...new Set([...files.values()].map((file) => file.type))].sort(),
    /** The name and the image text of one file, for a tag rule. */
    textOf: (id: string) => {
      const file = files.get(id)
      return file ? { name: file.name, ocrText: file.textLower } : null
    },
    state: (): IndexProgress & { version: number } => ({
      status,
      indexed: files.size,
      total: cached.size,
      version,
    }),
  }
}

export type SearchIndex = ReturnType<typeof createSearchIndex>
