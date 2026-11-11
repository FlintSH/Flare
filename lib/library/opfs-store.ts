import type { CachedRecord, RecordStore } from './search-index'

/**
 * The cache of encrypted records in the Origin Private File System
 * (docs/e2ee-spec.md, section 9.8.1). It holds what the server sent and
 * nothing that was decrypted: a person who reads it gets nothing that the
 * server does not have.
 *
 * One file for each account, a log of lines: a line is a record, or the IDs
 * of records that are gone. A change adds lines, and reading the log plays
 * them in order. The log is written again without its dead lines when it
 * has grown to more than twice its live content. A line that is cut off, as
 * after a crash, is skipped: the next update repairs what it held.
 *
 * Runs in a worker: only a worker can write a file of the OPFS with a
 * synchronous handle. The browser can delete the cache when storage is low,
 * and everything works without it.
 */

/** The directory of every account's cache. Removed at sign-out. */
export const SEARCH_CACHE_DIRECTORY = 'flare-e2ee-search'
const LOG = 'records.ndjson'
const LOCK = 'flare-e2ee-search-log'

type Line = { r: CachedRecord } | { d: string[] }

/** A user ID as a file name. */
const safeName = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, '_')

interface SyncHandle {
  getSize(): number
  write(buffer: Uint8Array, options: { at: number }): number
  truncate(size: number): void
  flush(): void
  close(): void
}

type LogFile = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncHandle>
}

/** Two tabs write one log. A lock makes each write whole. */
function locked<Result>(work: () => Promise<Result>): Promise<Result> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  return locks ? (locks.request(LOCK, work) as Promise<Result>) : work()
}

function replay(text: string) {
  const records = new Map<string, CachedRecord>()
  let lines = 0
  for (const raw of text.split('\n')) {
    if (!raw) continue
    lines++
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      continue
    }
    if ('r' in line && typeof line.r?.id === 'string')
      records.set(line.r.id, line.r)
    else if ('d' in line && Array.isArray(line.d))
      for (const id of line.d) records.delete(id)
  }
  return { records, lines }
}

const encoder = new TextEncoder()
const serialize = (lines: Line[]) =>
  encoder.encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(''))

/**
 * The store of one account, or null where the OPFS is not available: a
 * private window of some browsers, or a browser without it. Opening it
 * removes the caches of other accounts that used this browser.
 */
export async function openOpfsStore(
  userId: string
): Promise<RecordStore | null> {
  let file: LogFile
  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(SEARCH_CACHE_DIRECTORY, {
      create: true,
    })
    const mine = safeName(userId)
    const entries = directory as unknown as {
      keys(): AsyncIterable<string>
    }
    for await (const name of entries.keys())
      if (name !== mine)
        await directory
          .removeEntry(name, { recursive: true })
          .catch(() => undefined)
    const account = await directory.getDirectoryHandle(mine, { create: true })
    file = (await account.getFileHandle(LOG, { create: true })) as LogFile
    if (typeof file.createSyncAccessHandle !== 'function') return null
  } catch {
    return null
  }

  async function write(bytes: Uint8Array, replace = false) {
    await locked(async () => {
      const handle = await file.createSyncAccessHandle()
      try {
        if (replace) handle.truncate(0)
        handle.write(bytes, { at: handle.getSize() })
        handle.flush()
      } finally {
        handle.close()
      }
    })
  }

  return {
    persistent: true,
    async load() {
      const { records, lines } = replay(await (await file.getFile()).text())
      // Dead lines cost a read at every start: write the log again without them.
      if (lines > records.size * 2 + 1000)
        await write(
          serialize([...records.values()].map((record) => ({ r: record }))),
          true
        ).catch(() => undefined)
      return [...records.values()]
    },
    async put(records) {
      if (records.length)
        await write(serialize(records.map((record) => ({ r: record }))))
    },
    async remove(ids) {
      if (ids.length) await write(serialize([{ d: [...ids] }]))
    },
    async clear() {
      await write(new Uint8Array(0), true)
    },
  }
}

/**
 * Deletes every account's cache. For the page, at sign-out, after the worker
 * that wrote the cache has stopped. Never rejects: a sign-out must go on.
 */
export async function clearSearchCache(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(SEARCH_CACHE_DIRECTORY, { recursive: true })
  } catch {
    // No OPFS, or no cache: nothing is stored.
  }
}
