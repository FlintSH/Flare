import { saveBlobAsFile } from '@/lib/client/save-file'
import { type LocalFeed, localAddresses } from '@/lib/e2ee/client/local-address'
import { saveLocalAddress } from '@/lib/files/encrypted-client'
import { DOWNLOAD_BLOB_TYPE } from '@/lib/files/safe-render'

import {
  EXPORT_MEMORY_LIMIT_BYTES,
  type ExportManifest,
  type ExportProgress,
  type ExportSummary,
  exportFilename,
} from './export-client'
import type { ExportWorkerRequest, ExportWorkerResponse } from './export.worker'

/**
 * The page's side of the export that the browser builds
 * (docs/e2ee-spec.md, section 12.4). It picks where the ZIP goes, in this
 * order: a file the person chooses (File System Access API), a streamed
 * download through the service worker, or memory for a small export.
 */
export type ExportSink = 'file' | 'stream' | 'memory'

export class ExportTooLarge extends Error {
  constructor() {
    super(
      'This browser can only save an export of this size to a file you choose or through a service worker, and has neither. Use a current Chrome, Edge or Firefox over HTTPS, outside a private window.'
    )
    this.name = 'ExportTooLarge'
  }
}

type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

/**
 * Asks where to save the ZIP. `null`: this browser has no save dialog, or
 * refused to open one, and another way to save is used. Rejects with an
 * `AbortError` when the person closed the dialog.
 */
export async function chooseExportFile(
  filename: string
): Promise<FileSystemFileHandle | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker
  if (typeof picker !== 'function') return null
  try {
    return await picker.call(window, {
      suggestedName: filename,
      types: [
        { description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } },
      ],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error
    return null
  }
}

export interface RunningExport {
  /** Stops the export. Nothing is saved. */
  cancel(): void
  readonly done: Promise<{ summary: ExportSummary; sink: ExportSink }>
}

export function runExport(input: {
  manifest: ExportManifest
  keys: { accountPrivateKey: Uint8Array; oldPrivateKeys: readonly Uint8Array[] }
  /** From `chooseExportFile`. */
  file: FileSystemFileHandle | null
  filename?: string
  onProgress?: (progress: ExportProgress) => void
}): RunningExport {
  const filename = input.filename ?? exportFilename()
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), {
    type: 'module',
  })
  const cancelled = () => new DOMException('Cancelled', 'AbortError')
  let stopped: Error | null = null
  let waiting: {
    resolve: (message: ExportWorkerResponse) => void
    reject: (error: Error) => void
  } | null = null
  const stop = (error: Error) => {
    stopped ??= error
    worker.terminate()
    waiting?.reject(stopped)
    waiting = null
  }
  /** The next message that is not progress. */
  const next = () =>
    new Promise<ExportWorkerResponse>((resolve, reject) => {
      if (stopped) return reject(stopped)
      waiting = { resolve, reject }
    })
  worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
    const message = event.data
    if (message.type === 'progress') return input.onProgress?.(message.progress)
    if (message.type === 'error') return stop(new Error(message.message))
    const settle = waiting
    waiting = null
    settle?.resolve(message)
  }
  worker.onerror = (event) => {
    event.preventDefault()
    stop(new Error('The export stopped working. Start it again.'))
  }
  const post = (message: ExportWorkerRequest) => worker.postMessage(message)
  const pull = () => {
    const answer = next()
    post({ type: 'pull' })
    return answer
  }

  const done = (async () => {
    const first = input.file ? next() : null
    post({
      type: 'start',
      manifest: input.manifest,
      // Copies: the worker erases what it gets.
      accountPrivateKey: input.keys.accountPrivateKey.slice(),
      oldPrivateKeys: input.keys.oldPrivateKeys.map((key) => key.slice()),
      ...(input.file ? { file: input.file } : {}),
    })
    if (first) {
      const message = await first
      if (message.type !== 'done') throw new Error('Unexpected answer')
      return { summary: message.summary, sink: 'file' as const }
    }

    // No chosen file: a streamed download, fed from the worker.
    const service = await localAddresses()
    if (service) {
      let summary: ExportSummary | null = null
      const feed: LocalFeed = {
        async next() {
          const message = await pull()
          if (message.type === 'chunk')
            return { done: false, value: message.bytes }
          if (message.type === 'done') summary = message.summary
          return { done: true, value: undefined }
        },
        async return() {
          stop(cancelled())
          return { done: true, value: undefined }
        },
      }
      const result = await saveLocalAddress(
        service.create(
          {
            mode: 'download',
            contentType: DOWNLOAD_BLOB_TYPE,
            filename,
            source: { kind: 'feed' },
          },
          feed
        )
      )
      if (result === 'saved' && summary)
        return { summary: summary as ExportSummary, sink: 'stream' as const }
      if (result !== 'unavailable') throw stopped ?? cancelled()
      // No worker answered and nothing was read: memory is left.
    }

    const total = input.manifest.files.reduce(
      (sum, file) => sum + file.sizeBytes,
      0
    )
    if (total > EXPORT_MEMORY_LIMIT_BYTES) throw new ExportTooLarge()
    const parts: Uint8Array<ArrayBuffer>[] = []
    for (;;) {
      const message = await pull()
      if (message.type === 'chunk')
        parts.push(message.bytes as Uint8Array<ArrayBuffer>)
      else if (message.type === 'done') {
        saveBlobAsFile(new Blob(parts, { type: 'application/zip' }), filename)
        return { summary: message.summary, sink: 'memory' as const }
      }
    }
  })()
  done.then(
    () => worker.terminate(),
    (error: unknown) =>
      stop(error instanceof Error ? error : new Error('The export failed'))
  )
  return { cancel: () => stop(cancelled()), done }
}
