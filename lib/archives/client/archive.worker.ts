// The first import: see the file.
import { uploadEncryptedStream } from '@/lib/uploads/client'

import type { ArchiveOutputFormat } from '../shared'
import {
  type CreateResult,
  type ExtractResult,
  type ExtractionFolder,
  type JobFile,
  type JobProgress,
  type JobSource,
  type JobTarget,
  type PlannedFolder,
  createEncryptedArchive,
  extractEncryptedArchive,
} from './jobs'
import './zod-jitless'

/**
 * The worker that extracts and creates archives of encrypted files
 * (docs/e2ee-spec.md, section 12.3), so the page stays responsive while
 * megabytes are decrypted and encrypted. One worker does one job and is
 * terminated by the page, which is also how a job is cancelled.
 */
export type ArchiveWorkerRequest =
  | {
      type: 'extract'
      file: JobFile
      target: JobTarget
      accountPublicKey: Uint8Array
    }
  | {
      type: 'create'
      sources: JobSource[]
      output: { name: string; format: ArchiveOutputFormat }
      target: JobTarget
      accountPublicKey: Uint8Array
    }
  /** The page's answer to `folders`: the account folder of each path. */
  | { type: 'folders'; made: [path: string, folder: ExtractionFolder][] }

export type ArchiveWorkerResponse =
  | { type: 'progress'; progress: JobProgress }
  /**
   * The folders an extraction needs. The page makes them: only it has the
   * account private key, and their names never leave the browser unsealed.
   */
  | { type: 'folders'; planned: PlannedFolder[] }
  | { type: 'extracted'; result: ExtractResult }
  | { type: 'created'; result: CreateResult }
  /** `message` is for the person. It never holds a key. */
  | { type: 'error'; message: string; status?: number }

interface WorkerScope {
  onmessage: ((event: MessageEvent<ArchiveWorkerRequest>) => void) | null
  postMessage(message: ArchiveWorkerResponse): void
}

const scope = globalThis as unknown as WorkerScope

let foldersMade:
  ((made: ReadonlyMap<string, ExtractionFolder>) => void) | null = null

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'folders') {
    foldersMade?.(new Map(request.made))
    foldersMade = null
    return
  }
  const environment = {
    fetch: (url: string, init: RequestInit) => fetch(url, init),
    upload: uploadEncryptedStream,
    accountPublicKey: request.accountPublicKey,
    signal: new AbortController().signal,
    onProgress: (progress: JobProgress) =>
      scope.postMessage({ type: 'progress', progress }),
  }
  const work =
    request.type === 'extract'
      ? extractEncryptedArchive(request.file, request.target, {
          ...environment,
          // The page answers, or ends this worker if it cannot.
          folders: (planned) =>
            new Promise<ReadonlyMap<string, ExtractionFolder>>((resolve) => {
              foldersMade = resolve
              scope.postMessage({ type: 'folders', planned: [...planned] })
            }),
        }).then((result) => scope.postMessage({ type: 'extracted', result }))
      : createEncryptedArchive(
          request.sources,
          request.output,
          request.target,
          environment
        ).then((result) => scope.postMessage({ type: 'created', result }))
  work.catch((error: unknown) => {
    const named = error as { name?: string; status?: number } | null
    scope.postMessage({
      type: 'error',
      message:
        named?.name === 'E2eeError' || named?.name === 'DamagedEntry'
          ? 'A file did not pass its integrity check. It was changed or cut after it was encrypted, so nothing was made from it.'
          : named?.name === 'SourceError'
            ? 'A file could not be read from the server. It may have been deleted or made private.'
            : error instanceof Error && error.message
              ? error.message
              : 'The archive request could not be completed. Please try again.',
      status: typeof named?.status === 'number' ? named.status : undefined,
    })
  })
}
