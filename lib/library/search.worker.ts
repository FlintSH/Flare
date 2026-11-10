import {
  type AccountUnwrapper,
  createAccountUnwrapper,
  openSealedOcrText,
} from '@/lib/e2ee/client/files'
import { wipe } from '@/lib/e2ee/primitives'

import { openOpfsStore } from './opfs-store'
import type { OrderedEntry, ViewQuery } from './search-core'
import {
  type CachedRecord,
  type IndexProgress,
  type SearchIndex,
  type SyncApi,
  createMemoryStore,
  createSearchIndex,
} from './search-index'

/**
 * The worker of the local search (docs/e2ee-spec.md, section 9.8.2). It
 * reads the cache of encrypted records, asks the server for what changed,
 * opens each account stanza with the X25519 function of the browser, and
 * keeps the names, the types and the image text in its memory. The page
 * sends it a view and gets back the IDs that match. The plaintext never
 * goes to any storage, and no request of this worker carries a search.
 */
export type SearchWorkerRequest =
  | {
      type: 'start'
      /** The origin of the page: the worker's own address may be a `blob:` one. */
      origin: string
      userId: string
      accountPrivateKey: Uint8Array
      oldPrivateKeys: Uint8Array[]
    }
  | { type: 'sync'; call: number }
  | { type: 'query'; call: number; query: ViewQuery }
  | { type: 'rows'; call: number; ids: string[] }
  | { type: 'types'; call: number }
  | { type: 'drop'; call: number; ids: string[] }
  | { type: 'clear'; call: number }

export type SearchWorkerResponse =
  | { type: 'progress'; progress: IndexProgress & { persistent: boolean } }
  | { type: 'done'; call: number }
  | { type: 'entries'; call: number; entries: OrderedEntry[]; version: number }
  | { type: 'rows'; call: number; rows: CachedRecord[] }
  | { type: 'types'; call: number; types: string[] }
  | { type: 'error'; call: number }

interface WorkerScope {
  onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null
  postMessage(message: SearchWorkerResponse): void
}

const scope = globalThis as unknown as WorkerScope

let origin = ''

async function read<Answer>(path: string): Promise<Answer> {
  const response = await fetch(origin + path, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`The server answered ${response.status}`)
  const body = (await response.json()) as { data: Answer }
  return body.data
}

const api: SyncApi = {
  changes: (since) => read(`/api/files/sync?since=${since}&limit=500`),
  index: (after) =>
    read(
      `/api/files/sync?index=1${after ? `&after=${encodeURIComponent(after)}` : ''}`
    ),
  byIds: (ids) =>
    read(`/api/files/sync?ids=${ids.map(encodeURIComponent).join(',')}`),
}

let index: SearchIndex | null = null
let ready: Promise<unknown> = Promise.resolve()

async function start(request: Extract<SearchWorkerRequest, { type: 'start' }>) {
  origin = request.origin
  const unwrapper: AccountUnwrapper = await createAccountUnwrapper(request)
  wipe(request.accountPrivateKey, ...request.oldPrivateKeys)
  const store = (await openOpfsStore(request.userId)) ?? createMemoryStore()
  index = createSearchIndex({
    store,
    api,
    open: async (record) => {
      if (!record.encryption) return null
      const opened = await unwrapper.unwrap(record.encryption)
      let text: string | null = null
      if (record.sealedOcrText)
        try {
          text = openSealedOcrText(opened, record.sealedOcrText)
        } catch {
          text = null
        }
      // The key of the file is not kept: the index needs its name only.
      wipe(opened.fileKey)
      return { name: opened.name, type: opened.type, text }
    },
    onProgress: (progress) =>
      scope.postMessage({
        type: 'progress',
        progress: { ...progress, persistent: store.persistent },
      }),
  })
  await index.load()
  await index.sync()
}

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'start') {
    ready = start(request).catch(() => undefined)
    return
  }
  const { call } = request
  const answer = async () => {
    // A view is answered from what is open so far. The other requests wait
    // for the cache and the first update.
    if (request.type !== 'query' && request.type !== 'rows') await ready
    if (!index) throw new Error('The index has not started')
    switch (request.type) {
      case 'sync':
        await index.sync()
        return scope.postMessage({ type: 'done', call })
      case 'query':
        return scope.postMessage({
          type: 'entries',
          call,
          entries: index.query(request.query),
          version: index.state().version,
        })
      case 'rows':
        return scope.postMessage({
          type: 'rows',
          call,
          rows: index.rows(request.ids),
        })
      case 'types':
        return scope.postMessage({ type: 'types', call, types: index.types() })
      case 'drop':
        await index.drop(request.ids)
        return scope.postMessage({ type: 'done', call })
      case 'clear':
        await index.clear()
        return scope.postMessage({ type: 'done', call })
    }
  }
  void answer().catch(() => scope.postMessage({ type: 'error', call }))
}
