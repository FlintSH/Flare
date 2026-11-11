import { isE2eeError } from '../errors'
import { decryptFile, encryptFile, readableStreamChunks } from '../file'
import { concatBytes, wipe } from '../primitives'
import type { FileKey, NoncePrefix } from '../types'

/**
 * The worker that encrypts and decrypts file content, so the page stays
 * responsive (docs/e2ee-spec.md, sections 7.3 and 7.4). One worker does one
 * job and is terminated by the page.
 *
 * Encryption is pulled: the page asks for one part at a time, so the worker
 * never holds more ciphertext than the upload is ready to send. A part is
 * the header and stored chunks, at least `partBytes` long except the last.
 *
 * Decryption fetches the ciphertext here and gives out the plaintext of a
 * chunk only after its tag is correct. `done` is sent only after the final
 * chunk verified and no data followed it. Without `done` the page must not
 * use what it received as a file.
 */
export type FileWorkerRequest =
  | {
      type: 'encrypt'
      file: Blob
      fileKey: Uint8Array
      noncePrefix: Uint8Array
      partBytes: number
    }
  | { type: 'pull' }
  | { type: 'decrypt'; url: string; fileKey: Uint8Array }

export type FileWorkerResponse =
  | { type: 'part'; bytes: Uint8Array; last: boolean }
  | { type: 'progress'; loaded: number; total: number | null }
  | { type: 'chunk'; bytes: Uint8Array }
  | { type: 'done'; plaintextLength: number }
  /** `reason` is an `E2eeErrorReason`, `http_{status}` or `failed`. Never a secret. */
  | { type: 'error'; reason: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<FileWorkerRequest>) => void) | null
  postMessage(message: FileWorkerResponse, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

const send = (message: FileWorkerResponse) => {
  const bytes =
    message.type === 'part' || message.type === 'chunk' ? message.bytes : null
  scope.postMessage(message, bytes ? [bytes.buffer as ArrayBuffer] : [])
}

const fail = (error: unknown) =>
  send({
    type: 'error',
    reason: isE2eeError(error)
      ? error.reason
      : error instanceof HttpFailure
        ? `http_${error.status}`
        : 'failed',
  })

class HttpFailure extends Error {
  constructor(readonly status: number) {
    super('The server refused the request')
  }
}

let encryption: AsyncGenerator<Uint8Array, void, undefined> | null = null
let partBytes = 0
let pulling: Promise<void> = Promise.resolve()

async function nextPart() {
  if (!encryption) throw new Error('No encryption is in progress')
  const pieces: Uint8Array[] = []
  let length = 0
  let last = false
  while (length < partBytes) {
    const { done, value } = await encryption.next()
    if (done) {
      last = true
      break
    }
    pieces.push(value)
    length += value.length
  }
  // The generator ends one step after its final chunk. A part that filled
  // exactly at the end is followed by an empty last part, which the page
  // drops.
  send({ type: 'part', bytes: concatBytes(...pieces), last })
}

async function decrypt(url: string, fileKey: FileKey) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok || !response.body) throw new HttpFailure(response.status)
  const length = Number(response.headers.get('content-length'))
  const total = Number.isSafeInteger(length) && length > 0 ? length : null
  let loaded = 0
  let reported = 0
  async function* counted(stream: ReadableStream<Uint8Array>) {
    for await (const piece of readableStreamChunks(stream)) {
      loaded += piece.length
      if (loaded - reported >= 262144 || loaded === total) {
        reported = loaded
        send({ type: 'progress', loaded, total })
      }
      yield piece
    }
  }
  const plaintext = decryptFile(fileKey, counted(response.body))
  for (;;) {
    const step = await plaintext.next()
    if (step.done) {
      send({ type: 'done', plaintextLength: step.value.plaintextLength })
      return
    }
    send({ type: 'chunk', bytes: step.value })
  }
}

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'encrypt') {
    partBytes = request.partBytes
    const fileKey = request.fileKey as FileKey
    const source = encryptFile(
      fileKey,
      request.noncePrefix as NoncePrefix,
      readableStreamChunks(request.file.stream() as ReadableStream<Uint8Array>)
    )
    encryption = (async function* () {
      try {
        yield* source
      } finally {
        wipe(fileKey)
      }
    })()
    return
  }
  if (request.type === 'pull') {
    pulling = pulling.then(nextPart).catch(fail)
    return
  }
  const fileKey = request.fileKey as FileKey
  void decrypt(request.url, fileKey)
    .catch(fail)
    .finally(() => wipe(fileKey))
}
