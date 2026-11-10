import type { OpenedFile } from './files'
import type {
  ThumbnailWorkerRequest,
  ThumbnailWorkerResponse,
} from './thumbnail.worker'

/**
 * The decrypted thumbnails of this page, in memory only (docs/e2ee-spec.md,
 * section 12.1): a bounded list of object URLs, the least recently used
 * dropped first. A reload, a lock or a sign-out empties it. Nothing is
 * written to storage.
 */

/** How many thumbnails stay decrypted at once. A screen shows far fewer. */
export const THUMBNAIL_CACHE_SIZE = 300

type Entry = { url: string | null }

/** A bounded cache whose oldest entry is released when a new one does not fit. */
export function createLruCache<Value>(
  capacity: number,
  release: (value: Value) => void
) {
  const entries = new Map<string, Value>()
  return {
    get(key: string): Value | undefined {
      const value = entries.get(key)
      if (value !== undefined) {
        entries.delete(key)
        entries.set(key, value)
      }
      return value
    },
    set(key: string, value: Value) {
      const known = entries.get(key)
      if (known !== undefined) {
        entries.delete(key)
        if (known !== value) release(known)
      }
      entries.set(key, value)
      while (entries.size > capacity) {
        const [oldest, dropped] = entries.entries().next().value!
        entries.delete(oldest)
        release(dropped)
      }
    },
    delete(key: string) {
      const known = entries.get(key)
      if (known === undefined) return
      entries.delete(key)
      release(known)
    },
    clear() {
      for (const value of entries.values()) release(value)
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

const cache = createLruCache<Entry>(THUMBNAIL_CACHE_SIZE, (entry) => {
  if (entry.url) URL.revokeObjectURL(entry.url)
})
const loading = new Map<string, Promise<string | null>>()

let worker: Worker | null = null
let nextId = 0
const waiting = new Map<number, (response: ThumbnailWorkerResponse) => void>()

function thumbnailWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
    waiting.get(event.data.id)?.(event.data)
    waiting.delete(event.data.id)
  }
  worker.onerror = (event) => {
    event.preventDefault()
    // Every card that waits falls back to its icon. The next one starts a
    // new worker.
    for (const [id, settle] of waiting)
      settle({ id, bytes: null, reason: 'failed' })
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Whether bytes are a WebP image: `RIFF`, a length, `WEBP`. */
export function isWebp(bytes: Uint8Array) {
  const ascii = (offset: number, text: string) =>
    [...text].every(
      (character, index) => bytes[offset + index] === character.charCodeAt(0)
    )
  return bytes.length > 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')
}

/**
 * The object URL of a file's decrypted thumbnail, or null when it has none.
 * The bytes come from whoever uploaded the file, so they are shown only as
 * a WebP image: anything else is dropped (section 3.3, limit 2).
 */
export function sealedThumbnailUrl(
  fileId: string,
  opened: Pick<OpenedFile, 'fileKey' | 'headerHash'>
): Promise<string | null> {
  const known = cache.get(fileId)
  if (known) return Promise.resolve(known.url)
  const pending = loading.get(fileId)
  if (pending) return pending
  const work = new Promise<ThumbnailWorkerResponse>((resolve) => {
    const id = ++nextId
    waiting.set(id, resolve)
    thumbnailWorker().postMessage({
      id,
      // An absolute address: a worker's own address may not be one that a
      // relative path resolves against.
      url: new URL(
        `/api/files/${encodeURIComponent(fileId)}/sealed-thumbnail`,
        window.location.origin
      ).href,
      // A copy: the worker erases the key it was given.
      fileKey: opened.fileKey.slice(),
      headerHash: opened.headerHash.slice(),
    } satisfies ThumbnailWorkerRequest)
  })
    .then((response) => {
      const url =
        response.bytes && isWebp(response.bytes)
          ? URL.createObjectURL(
              new Blob([response.bytes as Uint8Array<ArrayBuffer>], {
                type: 'image/webp',
              })
            )
          : null
      // A failure is not remembered: the next card that asks tries again.
      if (response.bytes || response.reason === 'none')
        cache.set(fileId, { url })
      return url
    })
    .finally(() => loading.delete(fileId))
  loading.set(fileId, work)
  return work
}

/** Drops one thumbnail, after the file got a new one. */
export function forgetThumbnail(fileId: string) {
  cache.delete(fileId)
}

/** Drops every decrypted thumbnail: the keys of this browser are gone. */
export function forgetThumbnails() {
  cache.clear()
  worker?.terminate()
  worker = null
  for (const [id, settle] of waiting)
    settle({ id, bytes: null, reason: 'failed' })
  waiting.clear()
}
