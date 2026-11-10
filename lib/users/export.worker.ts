import { createAccountUnwrapper } from '@/lib/e2ee/client/files'
import { wipe } from '@/lib/e2ee/primitives'

import {
  type ExportManifest,
  type ExportProgress,
  type ExportSummary,
  exportArchive,
  planExport,
} from './export-client'

/**
 * The worker that builds the account export of an account with encrypted
 * files (docs/e2ee-spec.md, section 12.4). It writes the ZIP to a file the
 * person chose, or gives it to the page piece by piece when the page asks.
 * Decrypted bytes go only to that file or to the browser's download: never
 * to the Origin Private File System, IndexedDB or any other storage.
 */
export type ExportWorkerRequest =
  | {
      type: 'start'
      manifest: ExportManifest
      accountPrivateKey: Uint8Array
      oldPrivateKeys: Uint8Array[]
      /** A file from the save dialog. Absent: the page pulls the bytes. */
      file?: FileSystemFileHandle
    }
  | { type: 'pull' }

export type ExportWorkerResponse =
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'chunk'; bytes: Uint8Array }
  | { type: 'done'; summary: ExportSummary; bytes: number }
  /** `message` is for the person. It never holds a key or a file name. */
  | { type: 'error'; message: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null
  postMessage(message: ExportWorkerResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope
/** One piece for the page is at least this large, so messages stay few. */
const PIECE_BYTES = 1024 * 1024

let archive: AsyncGenerator<Uint8Array, void, undefined> | null = null
let summary: ExportSummary | null = null
let written = 0
let pulling: Promise<void> = Promise.resolve()

const fail = () =>
  scope.postMessage({
    type: 'error',
    message:
      'The export stopped before it was complete. Nothing was saved. Start it again.',
  })

async function start(request: Extract<ExportWorkerRequest, { type: 'start' }>) {
  const unwrapper = await createAccountUnwrapper({
    accountPrivateKey: request.accountPrivateKey,
    oldPrivateKeys: request.oldPrivateKeys,
  })
  let plan
  try {
    plan = await planExport(request.manifest, (records) =>
      unwrapper.unwrap(records)
    )
  } finally {
    unwrapper.close()
    wipe(request.accountPrivateKey, ...request.oldPrivateKeys)
  }
  archive = exportArchive(plan, {
    fetch: (url, init) => fetch(url, init),
    signal: new AbortController().signal,
    onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
    onDone: (result) => {
      summary = result
    },
  })
  if (!request.file) return
  // The file the person chose: the browser writes it next to a temporary
  // copy and replaces it only when `close` succeeds.
  const writable = await request.file.createWritable()
  try {
    for await (const piece of archive) {
      await writable.write(piece as Uint8Array<ArrayBuffer>)
      written += piece.length
    }
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
  scope.postMessage({ type: 'done', summary: summary!, bytes: written })
}

/** The next megabyte or so, or `done` after the last piece. */
async function pull() {
  if (!archive) throw new Error('No export is running')
  const pieces: Uint8Array[] = []
  let length = 0
  while (length < PIECE_BYTES) {
    const step = await archive.next()
    if (step.done) break
    pieces.push(step.value)
    length += step.value.length
  }
  if (!length) {
    scope.postMessage({ type: 'done', summary: summary!, bytes: written })
    return
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const piece of pieces) {
    bytes.set(piece, offset)
    offset += piece.length
  }
  written += length
  scope.postMessage({ type: 'chunk', bytes }, [bytes.buffer])
}

let started: Promise<void> = Promise.resolve()

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'start') {
    started = start(request)
    started.catch(fail)
  } else
    pulling = pulling
      .then(() => started)
      .then(pull)
      .catch(fail)
}
