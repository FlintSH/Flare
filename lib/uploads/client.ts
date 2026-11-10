import { workerArgon2id } from '@/lib/e2ee/client/argon2-worker'
import { encryptInWorker } from '@/lib/e2ee/client/file-worker'
import {
  type NewEncryptedFile,
  newEncryptedFile,
  newPasswordStanza,
} from '@/lib/e2ee/client/files'
import { rememberOpenedFile } from '@/lib/e2ee/client/opened-files'
import { storedLengthOf } from '@/lib/e2ee/file'
import { type ShareSecret, shareLink } from '@/lib/e2ee/link'

import {
  type UploadResponse,
  parseEncryptedUploadResponse,
  parseUploadResponse,
} from './response'

export type { UploadResponse }

const WHOLE_FILE_MAX_BYTES = 10 * 1024 * 1024
/**
 * S3 refuses parts under 5 MiB except the last, and the part route accepts at
 * most 64 MiB. With at most 10,000 parts, a file can be up to 48.8 GiB.
 */
const PART_BYTES = 5 * 1024 * 1024
const PARTS_AT_ONCE = 3

const NETWORK_ERROR = 'Network error occurred'
/** Flare answers 413 with its own message, so a bare 413 comes from a proxy. */
const REQUEST_TOO_LARGE =
  'The upload is larger than the server’s request size limit. Ask your administrator to raise it.'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type UploadOptions = {
  /** Omitted: the account's default profile. Null: no profile. */
  profileId?: string | null
  folderId?: string | null
  visibility?: 'PUBLIC' | 'PRIVATE'
  password?: string
  /** Omitted: the profile's expiration. Null: no expiration. */
  expiresAt?: Date | null
  expiryAction?: 'DELETE' | 'SET_PRIVATE'
  /**
   * Encrypt in this browser for this account public key before sending
   * (docs/e2ee-spec.md, section 10.1). Omitted: a plain upload, which the
   * server can read and show in a link preview (section 11).
   */
  encryptFor?: Uint8Array
  /** Stops the upload. The promise rejects with an `AbortError`. */
  signal?: AbortSignal
}

/** Bytes of the file sent so far. */
type Progress = (uploaded: number) => void

/** Splits files by the server's maximum file size, which it checks again. */
export function partitionBySize(files: readonly File[], maxSize: number) {
  const fitting: File[] = []
  const tooLarge: File[] = []
  for (const file of files)
    (file.size > maxSize ? tooLarge : fitting).push(file)
  return { fitting, tooLarge }
}

type Reply = { status: number; statusText: string; body: unknown }

function readJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** XMLHttpRequest, because fetch can't report upload progress. */
function send(
  method: 'POST' | 'PUT',
  url: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  onProgress?: Progress,
  signal?: AbortSignal
) {
  return new Promise<Reply>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const cancelled = () => new DOMException('Upload cancelled', 'AbortError')
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    if (onProgress)
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded)
      })
    request.addEventListener('load', () =>
      resolve({
        status: request.status,
        statusText: request.statusText,
        body: readJson(request.responseText),
      })
    )
    request.addEventListener('error', () => reject(new Error(NETWORK_ERROR)))
    request.addEventListener('abort', () =>
      reject(signal?.aborted ? cancelled() : new Error(NETWORK_ERROR))
    )
    request.open(method, url)
    for (const [name, value] of Object.entries(headers))
      request.setRequestHeader(name, value)
    request.send(body)
  })
}

const succeeded = (reply: Reply) => reply.status >= 200 && reply.status < 300

function failure(reply: Reply, fallback: string) {
  const message = field(reply.body, 'error')
  return new Error(
    typeof message === 'string' && message
      ? message
      : reply.status === 413
        ? REQUEST_TOO_LARGE
        : fallback
  )
}

/** The profile and folder go in headers: the server fixes them before reading the file. */
function selectionHeaders(options: UploadOptions): Record<string, string> {
  return {
    ...(options.profileId !== undefined && {
      'X-Upload-Profile': options.profileId ?? 'none',
    }),
    ...(options.folderId ? { 'X-Upload-Folder': options.folderId } : {}),
  }
}

function multipartBody(file: File, options: UploadOptions) {
  const body = new FormData()
  body.append('file', file)
  if (options.visibility) body.append('visibility', options.visibility)
  if (options.password) body.append('password', options.password)
  if (options.expiresAt !== undefined)
    body.append('expiresAt', options.expiresAt?.toISOString() ?? '')
  if (options.expiryAction) body.append('expiryAction', options.expiryAction)
  return body
}

async function uploadWhole(
  file: File,
  options: UploadOptions,
  onProgress?: Progress
) {
  const reply = await send(
    'POST',
    '/api/files',
    multipartBody(file, options),
    selectionHeaders(options),
    onProgress,
    options.signal
  )
  if (!succeeded(reply))
    throw failure(reply, `Upload failed: ${reply.statusText}`)
  const uploaded = parseUploadResponse(reply.body)
  onProgress?.(file.size)
  return uploaded
}

async function startChunkedUpload(file: File, options: UploadOptions) {
  const reply = await send(
    'POST',
    '/api/files/chunks',
    JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      profileId: options.profileId,
      folderId: options.folderId ?? null,
      visibility: options.visibility,
      password: options.password || undefined,
      expiresAt:
        options.expiresAt === undefined
          ? undefined
          : (options.expiresAt?.toISOString() ?? null),
      expiryAction: options.expiryAction,
    }),
    JSON_HEADERS,
    undefined,
    options.signal
  )
  if (!succeeded(reply)) throw failure(reply, 'Failed to initialize upload')
  const session = field(reply.body, 'data')
  const uploadId = field(session, 'uploadId')
  if (typeof uploadId !== 'string' || !uploadId || !field(session, 'fileKey'))
    throw new Error('Failed to initialize upload')
  return encodeURIComponent(uploadId)
}

async function uploadInParts(
  file: File,
  options: UploadOptions,
  onProgress?: Progress
) {
  const uploadId = await startChunkedUpload(file, options)
  const sent = new Map<number, number>()
  const report = (part: number, bytes: number) => {
    sent.set(part, bytes)
    let total = 0
    for (const value of sent.values()) total += value
    onProgress?.(total)
  }
  const parts: { ETag: string; PartNumber: number }[] = []
  const sendPart = async (part: number) => {
    const chunk = file.slice(
      (part - 1) * PART_BYTES,
      Math.min(part * PART_BYTES, file.size)
    )
    const reply = await send(
      'PUT',
      `/api/files/chunks/${uploadId}/part/${part}`,
      chunk,
      {},
      (bytes) => report(part, bytes),
      options.signal
    )
    if (!succeeded(reply))
      throw failure(reply, `Upload failed: ${reply.statusText}`)
    report(part, chunk.size)
    const etag = field(field(reply.body, 'data'), 'etag')
    if (typeof etag !== 'string') throw new Error('Failed to parse response')
    parts.push({ ETag: etag, PartNumber: part })
  }
  const count = Math.ceil(file.size / PART_BYTES)
  for (let first = 1; first <= count; first += PARTS_AT_ONCE) {
    const last = Math.min(count, first + PARTS_AT_ONCE - 1)
    const batch: Promise<void>[] = []
    for (let part = first; part <= last; part++) batch.push(sendPart(part))
    const failed = (await Promise.allSettled(batch)).find(
      (result) => result.status === 'rejected'
    )
    if (failed) throw failed.reason
  }
  const reply = await send(
    'POST',
    `/api/files/chunks/${uploadId}/complete`,
    JSON.stringify({
      parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
    }),
    JSON_HEADERS,
    undefined,
    options.signal
  )
  if (!succeeded(reply)) throw failure(reply, 'Failed to complete upload')
  return parseUploadResponse(reply.body)
}

// --- Encrypted uploads (docs/e2ee-spec.md, section 10.1) ---

/**
 * The size of one encrypted part: 80 stored chunks, a little over the 5 MiB
 * that S3 needs for every part but the last.
 */
const ENCRYPTED_PART_BYTES = 80 * 65568
const ENCRYPTED_HEADERS = { 'X-Flare-Encrypted': 'true' }
/** The file part carries this name and type. The real ones are sealed. */
const ENCRYPTED_PART_NAME = 'encrypted'
const ENCRYPTED_PART_TYPE = 'application/octet-stream'

/** The options the server reads, which are the same for a plain upload. */
function visibleOptions(options: UploadOptions) {
  return {
    visibility: options.visibility,
    expiresAt:
      options.expiresAt === undefined
        ? undefined
        : (options.expiresAt?.toISOString() ?? null),
    expiryAction: options.expiryAction,
  }
}

/**
 * Steps 1, 2, 4 and 6 of section 10.1: the key, the header, the sealed name
 * and type, the account stanza and, with a password, the password stanza.
 * The password goes through Argon2id in a worker and never leaves the
 * browser.
 */
async function prepareEncryptedUpload(
  file: File,
  options: UploadOptions & { encryptFor: Uint8Array }
) {
  const created = newEncryptedFile({
    name: file.name,
    type: file.type || ENCRYPTED_PART_TYPE,
    accountPublicKey: options.encryptFor,
  })
  let secret: ShareSecret = { kind: 'file_key', fileKey: created.fileKey }
  let passwordStanza: string | undefined
  if (options.password) {
    const stanza = await newPasswordStanza({
      opened: created,
      password: options.password,
      ownerPublicKey: options.encryptFor,
      argon2id: workerArgon2id,
    })
    passwordStanza = stanza.passwordStanza
    secret = stanza.secret
  }
  options.signal?.throwIfAborted()
  return {
    created,
    secret,
    records: { ...created.records, ...(passwordStanza && { passwordStanza }) },
  }
}

/** The link is made here: the server never has the part after `#` (section 10.3). */
function encryptedUploadResult(
  body: unknown,
  file: File,
  created: NewEncryptedFile,
  secret: ShareSecret
): UploadResponse {
  const uploaded = parseEncryptedUploadResponse(body)
  const link = shareLink(uploaded.pageUrl, secret)
  rememberOpenedFile(uploaded.id, {
    fileKey: created.fileKey,
    headerHash: created.headerHash,
    name: file.name,
    type: file.type || ENCRYPTED_PART_TYPE,
  })
  return {
    url: link,
    pageUrl: link,
    copyText: link,
    name: file.name,
    size: file.size,
    type: file.type || ENCRYPTED_PART_TYPE,
    encrypted: true,
  }
}

async function uploadEncrypted(
  file: File,
  options: UploadOptions & { encryptFor: Uint8Array },
  onProgress?: Progress,
  extraHeaders: Record<string, string> = {}
): Promise<UploadResponse> {
  const { created, secret, records } = await prepareEncryptedUpload(
    file,
    options
  )
  const storedLength = storedLengthOf(file.size)
  // Progress is reported in bytes of the file, as for a plain upload.
  const report = (sent: number) =>
    onProgress?.(
      Math.min(file.size, Math.floor((sent / storedLength) * file.size))
    )
  const job = encryptInWorker({
    file,
    fileKey: created.fileKey,
    noncePrefix: created.noncePrefix,
    partBytes: ENCRYPTED_PART_BYTES,
    signal: options.signal,
  })
  try {
    if (file.size <= WHOLE_FILE_MAX_BYTES) {
      const parts: Uint8Array<ArrayBuffer>[] = []
      for (;;) {
        const part = await job.nextPart()
        if (part.bytes.length) parts.push(part.bytes as Uint8Array<ArrayBuffer>)
        if (part.last) break
      }
      const body = new FormData()
      // Fields first, so a reader that stops at the file has them.
      for (const [name, value] of Object.entries({
        ...records,
        ...visibleOptions(options),
      }))
        if (value !== undefined) body.append(name, value ?? '')
      body.append(
        'file',
        new Blob(parts, { type: ENCRYPTED_PART_TYPE }),
        ENCRYPTED_PART_NAME
      )
      const reply = await send(
        'POST',
        '/api/files',
        body,
        { ...ENCRYPTED_HEADERS, ...extraHeaders, ...selectionHeaders(options) },
        report,
        options.signal
      )
      if (!succeeded(reply))
        throw failure(reply, `Upload failed: ${reply.statusText}`)
      onProgress?.(file.size)
      return encryptedUploadResult(reply.body, file, created, secret)
    }

    const started = await send(
      'POST',
      '/api/files/chunks',
      JSON.stringify({
        encrypted: true,
        size: storedLength,
        ...records,
        profileId: options.profileId,
        folderId: options.folderId ?? null,
        ...visibleOptions(options),
      }),
      JSON_HEADERS,
      undefined,
      options.signal
    )
    if (!succeeded(started))
      throw failure(started, 'Failed to initialize upload')
    const session = field(started.body, 'data')
    const id = field(session, 'uploadId')
    if (typeof id !== 'string' || !id)
      throw new Error('Failed to initialize upload')
    const uploadId = encodeURIComponent(id)
    const sent = new Map<number, number>()
    const reportPart = (part: number, bytes: number) => {
      sent.set(part, bytes)
      let total = 0
      for (const value of sent.values()) total += value
      report(total)
    }
    const parts: { ETag: string; PartNumber: number }[] = []
    const sendPart = async (number: number, bytes: Uint8Array<ArrayBuffer>) => {
      const reply = await send(
        'PUT',
        `/api/files/chunks/${uploadId}/part/${number}`,
        new Blob([bytes], { type: ENCRYPTED_PART_TYPE }),
        {},
        (loaded) => reportPart(number, loaded),
        options.signal
      )
      if (!succeeded(reply))
        throw failure(reply, `Upload failed: ${reply.statusText}`)
      reportPart(number, bytes.length)
      const etag = field(field(reply.body, 'data'), 'etag')
      if (typeof etag !== 'string') throw new Error('Failed to parse response')
      parts.push({ ETag: etag, PartNumber: number })
    }
    // Encrypts as many parts as are sent at once, then waits for them: the
    // browser never holds more ciphertext than that.
    let number = 0
    let last = false
    while (!last) {
      const batch: Promise<void>[] = []
      while (!last && batch.length < PARTS_AT_ONCE) {
        const part = await job.nextPart()
        last = part.last
        if (part.bytes.length)
          batch.push(sendPart(++number, part.bytes as Uint8Array<ArrayBuffer>))
      }
      const failed = (await Promise.allSettled(batch)).find(
        (result) => result.status === 'rejected'
      )
      if (failed) throw failed.reason
    }
    const reply = await send(
      'POST',
      `/api/files/chunks/${uploadId}/complete`,
      JSON.stringify({
        parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      }),
      JSON_HEADERS,
      undefined,
      options.signal
    )
    if (!succeeded(reply)) throw failure(reply, 'Failed to complete upload')
    onProgress?.(file.size)
    return encryptedUploadResult(reply.body, file, created, secret)
  } finally {
    job.stop()
  }
}

export function uploadFile(
  file: File,
  options: UploadOptions,
  onProgress?: Progress
): Promise<UploadResponse> {
  if (options.encryptFor)
    return uploadEncrypted(
      file,
      { ...options, encryptFor: options.encryptFor },
      onProgress
    )
  return file.size > WHOLE_FILE_MAX_BYTES
    ? uploadInParts(file, options, onProgress)
    : uploadWhole(file, options, onProgress)
}

/** Always one request, which the server checks for `pastes.create`. */
export async function uploadPaste(
  file: File,
  options: Pick<
    UploadOptions,
    'profileId' | 'visibility' | 'password' | 'encryptFor'
  >
): Promise<UploadResponse> {
  // A paste is a file, encrypted like any other (section 12.5).
  if (options.encryptFor) {
    if (file.size > WHOLE_FILE_MAX_BYTES)
      throw new Error('This paste is too large. Upload it as a file instead.')
    return uploadEncrypted(
      file,
      { ...options, encryptFor: options.encryptFor },
      undefined,
      { 'X-Flare-Paste': 'true' }
    )
  }
  const reply = await send('POST', '/api/files', multipartBody(file, options), {
    'X-Flare-Paste': 'true',
    ...selectionHeaders(options),
  })
  if (!succeeded(reply))
    throw failure(reply, 'Could not create your paste. Please try again.')
  return parseUploadResponse(reply.body)
}
