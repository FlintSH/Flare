import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'

import { clearSearchCache } from './opfs-store'
import type { OrderedEntry, ViewQuery } from './search-core'
import type { CachedRecord, IndexProgress } from './search-index'
import type { SearchWorkerRequest, SearchWorkerResponse } from './search.worker'

/**
 * The page's side of the search worker (docs/e2ee-spec.md, section 9.8):
 * one worker for the unlocked account of this tab. It starts when the keys
 * unlock and stops when they go. Its plaintext is gone with it. At sign-out
 * the cache of encrypted records is deleted too. Client only.
 */

export interface SearchIndexState extends IndexProgress {
  /** Moves on whenever the files in memory change. */
  readonly version: number
  /** Whether the encrypted records are cached between sessions. */
  readonly persistent: boolean
  /** No worker runs: the keys are locked. */
  readonly stopped: boolean
}

const STOPPED: SearchIndexState = {
  status: 'loading',
  indexed: 0,
  total: 0,
  version: 0,
  persistent: false,
  stopped: true,
}

let worker: Worker | null = null
let state = STOPPED
let startedFor: StoredAccountKeys | null = null
let nextCall = 0
const calls = new Map<
  number,
  { resolve: (response: SearchWorkerResponse) => void; reject: () => void }
>()
const watchers = new Set<() => void>()

function publish(next: SearchIndexState) {
  state = next
  for (const watch of watchers) watch()
}

function send<Kind extends SearchWorkerResponse['type']>(
  request: SearchWorkerRequest & { call: number },
  kind: Kind
): Promise<Extract<SearchWorkerResponse, { type: Kind }>> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('Search is not running'))
      return
    }
    calls.set(request.call, {
      resolve: (response) =>
        response.type === kind
          ? resolve(response as Extract<SearchWorkerResponse, { type: Kind }>)
          : reject(new Error('The search index could not answer')),
      reject: () => reject(new Error('Search stopped')),
    })
    worker.postMessage(request)
  })
}

export const searchIndex = {
  subscribe(watch: () => void) {
    watchers.add(watch)
    return () => {
      watchers.delete(watch)
    }
  },
  getState: () => state,

  /** Starts the worker for these keys. Does nothing if it runs for them already. */
  start(keys: StoredAccountKeys) {
    if (worker && startedFor === keys) return
    this.stop()
    startedFor = keys
    worker = new Worker(new URL('./search.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        publish({
          ...message.progress,
          version: state.version + 1,
          stopped: false,
        })
        return
      }
      calls.get(message.call)?.resolve(message)
      calls.delete(message.call)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      this.stop()
    }
    publish({ ...STOPPED, stopped: false })
    worker.postMessage({
      type: 'start',
      userId: keys.userId,
      // Copies: the worker erases the keys it was given after it imported them.
      accountPrivateKey: keys.accountPrivateKey.slice(),
      oldPrivateKeys: keys.oldPrivateKeys.map((key) => key.slice()),
    } satisfies SearchWorkerRequest)
  },

  /** Stops the worker. The names and the text in its memory are gone. */
  stop() {
    worker?.terminate()
    worker = null
    startedFor = null
    for (const call of calls.values()) call.reject()
    calls.clear()
    if (!state.stopped) publish(STOPPED)
  },

  /** Asks the server for what changed. Resolves when the index is up to date. */
  async sync(): Promise<void> {
    await send({ type: 'sync', call: ++nextCall }, 'done')
  },

  /** The encrypted files that a view selects, with their sort keys. */
  async query(query: ViewQuery): Promise<OrderedEntry[]> {
    return (await send({ type: 'query', call: ++nextCall, query }, 'entries'))
      .entries
  },

  /** The list rows of encrypted files, from the cache. */
  async rows(ids: string[]): Promise<CachedRecord[]> {
    return (await send({ type: 'rows', call: ++nextCall, ids }, 'rows')).rows
  },

  /** The types of the encrypted files, for the type filter. */
  async types(): Promise<string[]> {
    return (await send({ type: 'types', call: ++nextCall }, 'types')).types
  },

  /** Takes deleted files out of the cache at once. */
  async drop(ids: string[]): Promise<void> {
    if (worker) await send({ type: 'drop', call: ++nextCall, ids }, 'done')
  },
}

/**
 * Ends search for a session that is over: stops the worker and deletes the
 * cache of encrypted records (section 9.8.1). Never rejects.
 */
export async function endSearchSession(): Promise<void> {
  searchIndex.stop()
  await clearSearchCache()
}
