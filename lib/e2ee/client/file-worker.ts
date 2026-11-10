import { E2EE_ERROR_REASONS, E2eeError, type E2eeErrorReason } from '../errors'
import type { FileKey, NoncePrefix } from '../types'
import type { FileWorkerRequest, FileWorkerResponse } from './file.worker'

/**
 * The page's side of `file.worker.ts`. Each call starts one worker and
 * terminates it when the job ends or the caller aborts.
 */

/** The server refused the ciphertext, with its HTTP status. */
export class CiphertextRefused extends Error {
  constructor(readonly status: number) {
    super('The server refused the file')
    this.name = 'CiphertextRefused'
  }
}

function startWorker(): Worker {
  return new Worker(new URL('./file.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function failure(reason: string): Error {
  if ((E2EE_ERROR_REASONS as readonly string[]).includes(reason))
    return new E2eeError(reason as E2eeErrorReason, 'The file did not open')
  const status = /^http_(\d{3})$/.exec(reason)?.[1]
  return status
    ? new CiphertextRefused(Number(status))
    : new Error('The file could not be processed')
}

const aborted = () => new DOMException('Aborted', 'AbortError')

export interface EncryptionJob {
  /** The next part of the encrypted file. After `last`, there are no more. */
  nextPart(): Promise<{ bytes: Uint8Array; last: boolean }>
  /** Stops the worker. Safe to call more than one time. */
  stop(): void
}

/**
 * Encrypts `file` in a worker, one part at a time. The worker reads the
 * file as a stream and holds at most one part.
 */
export function encryptInWorker(input: {
  file: Blob
  fileKey: FileKey
  noncePrefix: NoncePrefix
  partBytes: number
  signal?: AbortSignal
}): EncryptionJob {
  const worker = startWorker()
  let waiting: {
    resolve: (part: { bytes: Uint8Array; last: boolean }) => void
    reject: (error: Error) => void
  } | null = null
  let ended: Error | null = null
  const end = (error: Error) => {
    ended ??= error
    worker.terminate()
    waiting?.reject(ended)
    waiting = null
  }
  worker.onmessage = (event: MessageEvent<FileWorkerResponse>) => {
    const message = event.data
    if (message.type === 'part') {
      waiting?.resolve({ bytes: message.bytes, last: message.last })
      waiting = null
    } else if (message.type === 'error') end(failure(message.reason))
  }
  worker.onerror = (event) => {
    event.preventDefault()
    end(new Error('The file could not be encrypted'))
  }
  input.signal?.addEventListener('abort', () => end(aborted()), { once: true })
  const request: FileWorkerRequest = {
    type: 'encrypt',
    file: input.file,
    // A copy: the page keeps its key for the share link.
    fileKey: input.fileKey.slice(),
    noncePrefix: input.noncePrefix.slice(),
    partBytes: input.partBytes,
  }
  worker.postMessage(request)
  return {
    nextPart() {
      if (ended) return Promise.reject(ended)
      if (input.signal?.aborted) return Promise.reject(aborted())
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject }
        worker.postMessage({ type: 'pull' } satisfies FileWorkerRequest)
      })
    },
    stop: () => end(aborted()),
  }
}

export interface DecryptedContent {
  /** The plaintext, complete and verified to its final chunk. */
  readonly parts: Uint8Array<ArrayBuffer>[]
  readonly length: number
}

/**
 * Fetches and decrypts a whole file in a worker. Resolves only after the
 * final chunk verified (section 7.4): a truncated or changed file rejects,
 * and nothing of it is returned.
 *
 * `maxBytes` stops a file that proves larger than the caller can hold.
 */
export function decryptInWorker(input: {
  url: string
  fileKey: FileKey
  signal?: AbortSignal
  maxBytes?: number
  onProgress?: (loaded: number, total: number | null) => void
}): Promise<DecryptedContent> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(aborted())
      return
    }
    const worker = startWorker()
    const parts: Uint8Array<ArrayBuffer>[] = []
    let length = 0
    let settled = false
    const end = (error: Error | null) => {
      if (settled) return
      settled = true
      worker.terminate()
      if (error) {
        parts.length = 0
        reject(error)
      } else resolve({ parts, length })
    }
    worker.onmessage = (event: MessageEvent<FileWorkerResponse>) => {
      const message = event.data
      if (message.type === 'chunk') {
        length += message.bytes.length
        if (input.maxBytes !== undefined && length > input.maxBytes)
          end(new RangeError('The file is larger than expected'))
        else parts.push(message.bytes as Uint8Array<ArrayBuffer>)
      } else if (message.type === 'progress')
        input.onProgress?.(message.loaded, message.total)
      else if (message.type === 'done')
        end(
          message.plaintextLength === length
            ? null
            : new E2eeError('truncated', 'The file is not complete')
        )
      else if (message.type === 'error') end(failure(message.reason))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      end(new Error('The file could not be decrypted'))
    }
    input.signal?.addEventListener('abort', () => end(aborted()), {
      once: true,
    })
    worker.postMessage({
      type: 'decrypt',
      url: input.url,
      fileKey: input.fileKey.slice(),
    } satisfies FileWorkerRequest)
  })
}
