import { workerArgon2id } from '@/lib/e2ee/client/argon2-worker'
import { encryptInWorker } from '@/lib/e2ee/client/file-worker'
import {
  type NewEncryptedFile,
  type OpenedFile,
  newEncryptedFile,
  newPasswordStanza,
  sealedThumbnailRecord,
} from '@/lib/e2ee/client/files'
import { type OpenedFolder, folderStanzaFor } from '@/lib/e2ee/client/folders'
import { rememberOpenedFile } from '@/lib/e2ee/client/opened-files'
import { encryptFile, storedLengthOf } from '@/lib/e2ee/file'
import { type ShareSecret, ownOriginPath, shareLink } from '@/lib/e2ee/link'

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
  /** What the browser of the owner does for the library around an upload. */
  library?: UploadLibrary
  /** Stops the upload. The promise rejects with an `AbortError`. */
  signal?: AbortSignal
}

/**
 * The work of section 10.1, steps 5 and 7, that needs more than the file:
 * the keys of its folder, the tag rules of the owner, a thumbnail. Each
 * part is optional. What a client does not do here, it declares as not
 * done, and the server keeps it for the browser of the owner (section 9.7).
 */
export interface UploadLibrary {
  /**
   * The folder of the upload, opened by its owner. A public encrypted file
   * gets a folder stanza for its key (section 8.4.3).
   */
  folder?: Pick<OpenedFolder, 'folderPublicKey'> | null
  /** The tags that the owner's rules give a file with this name. */
  ruleTagIds?(name: string): string[]
  /**
   * A WebP thumbnail of the file (section 12.1). Null when none can be
   * made for this kind of file. It rejects when one could not be made now.
   */
  thumbnail?(file: File): Promise<Uint8Array | null>
  /** Called once the server stored the file, with its ID and its key. */
  uploaded?(result: {
    id: string
    file: File
    plain: boolean
    opened: OpenedFile | null
  }): void
}

/** Whether a type is an image whose text a browser can read (section 9.6). */
export function isReadableImage(type: string) {
  return /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(type)
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
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    // The signal lives as long as the upload, and its listener holds this
    // request with the body it sent. Without this, every part of a large
    // upload stayed in memory until the last one: 2 GiB for a 2 GiB file.
    request.addEventListener('loadend', () =>
      signal?.removeEventListener('abort', abort)
    )
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

/** A plain upload has no key and no ID in its answer: the queue is only told. */
function plainUploaded<Result>(file: File, options: UploadOptions) {
  return (result: Result) => {
    options.library?.uploaded?.({ id: '', file, plain: true, opened: null })
    return result
  }
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
const ENCRYPTED_PART_HEADERS = { 'Content-Type': 'application/octet-stream' }
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
  file: Pick<File, 'name' | 'type'>,
  options: UploadOptions & { encryptFor: Uint8Array },
  /** The whole plaintext, when the page holds it. A stream has none. */
  whole?: File
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
  // Section 10.1, steps 5 and 7. Each value is ciphertext, a public key, an
  // ID or a declaration of the work that was done.
  const library = options.library
  const type = file.type || ENCRYPTED_PART_TYPE
  const extra: Record<string, string> = {
    rulesApplied: String(Boolean(library?.ruleTagIds)),
    isImage: String(isReadableImage(type)),
  }
  if (library?.folder && options.folderId && options.visibility === 'PUBLIC')
    Object.assign(extra, folderStanzaFor(library.folder, created, secret))
  if (library?.ruleTagIds) {
    const tagIds = library.ruleTagIds(file.name)
    if (tagIds.length) extra.ruleTagIds = tagIds.join(',')
  }
  // A stream has no thumbnail now. The server marks the file, and the
  // background work of the owner's browser makes one (section 9.7).
  if (library?.thumbnail && whole)
    try {
      const thumbnail = await library.thumbnail(whole)
      if (thumbnail)
        extra.sealedThumbnail = sealedThumbnailRecord(created, thumbnail)
      else extra.thumbnail = 'none'
    } catch {
      // Not made now: the server marks the file, and the background work
      // of this browser tries again.
    }
  options.signal?.throwIfAborted()
  return {
    created,
    secret,
    records: {
      ...created.records,
      ...(passwordStanza && { passwordStanza }),
      ...extra,
    },
  }
}

/** The link is made here: the server never has the part after `#` (section 10.3). */
function encryptedUploadResult(
  body: unknown,
  file: Pick<File, 'name' | 'type' | 'size'>,
  created: NewEncryptedFile,
  secret: ShareSecret,
  library?: UploadLibrary,
  whole?: File
): UploadResponse {
  const uploaded = parseEncryptedUploadResponse(body)
  // The key goes only into an address of this origin, whatever origin the
  // answer of the server names. A worker has `location` too.
  const { origin } = globalThis.location
  const link = shareLink(
    `${origin}${ownOriginPath(uploaded.pageUrl, origin)}`,
    secret
  )
  const opened: OpenedFile = {
    fileKey: created.fileKey,
    headerHash: created.headerHash,
    name: file.name,
    type: file.type || ENCRYPTED_PART_TYPE,
  }
  rememberOpenedFile(uploaded.id, opened)
  if (whole)
    library?.uploaded?.({ id: uploaded.id, file: whole, plain: false, opened })
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
    options,
    file
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
      return encryptedUploadResult(
        reply.body,
        file,
        created,
        secret,
        options.library,
        file
      )
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
        // The bytes themselves, not a Blob of them: a browser counts every
        // Blob against a store of limited size, and frees one only after
        // garbage collection.
        bytes,
        ENCRYPTED_PART_HEADERS,
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
    return encryptedUploadResult(
      reply.body,
      file,
      created,
      secret,
      options.library,
      file
    )
  } finally {
    job.stop()
  }
}

/** Plaintext that is made as it is uploaded: an archive entry, a new archive. */
export interface EncryptedStreamSource {
  readonly name: string
  readonly type: string
  /**
   * The exact number of bytes, where it is known before they are read. The
   * upload then goes out as it is encrypted. Without it the ciphertext is
   * kept as Blobs until its size is known, because the server needs the
   * size before the first part.
   */
  readonly size?: number
  readonly bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
}

/** The new file, with the records that open it with the account key. */
export type EncryptedStreamUpload = UploadResponse & {
  readonly id: string
  readonly records: NewEncryptedFile['records']
}

/**
 * Encrypts a stream and uploads it as a new file (docs/e2ee-spec.md,
 * sections 10.1 and 12.3). The cipher runs where this is called, so call
 * it in a worker. At most one part of plaintext and the parts in flight
 * are in memory; ciphertext that waits for its size is in Blobs, which the
 * browser may keep on disk. They hold no plaintext.
 */
export async function uploadEncryptedStream(
  source: EncryptedStreamSource,
  options: UploadOptions & { encryptFor: Uint8Array },
  onProgress?: Progress
): Promise<EncryptedStreamUpload> {
  const { created, secret, records } = await prepareEncryptedUpload(
    source,
    options
  )
  let plaintextBytes = 0
  async function* counted() {
    for await (const piece of source.bytes) {
      plaintextBytes += piece.length
      onProgress?.(plaintextBytes)
      yield piece
    }
  }
  const stored = encryptFile(created.fileKey, created.noncePrefix, counted())
  /** The next part: the header and stored chunks, a little over 5 MiB. */
  async function nextPart(): Promise<Uint8Array<ArrayBuffer> | null> {
    const pieces: Uint8Array[] = []
    let length = 0
    while (length < ENCRYPTED_PART_BYTES) {
      const step = await stored.next()
      if (step.done) break
      pieces.push(step.value)
      length += step.value.length
    }
    options.signal?.throwIfAborted()
    if (!length) return null
    const part = new Uint8Array(length)
    let offset = 0
    for (const piece of pieces) {
      part.set(piece, offset)
      offset += piece.length
    }
    return part
  }
  const result = (body: unknown): EncryptedStreamUpload => ({
    ...encryptedUploadResult(
      body,
      { name: source.name, type: source.type, size: plaintextBytes },
      created,
      secret
    ),
    id: parseEncryptedUploadResponse(body).id,
    records: created.records,
  })

  // Without a size, every part waits. With one, a small file waits whole
  // (it is one request) and a large one is sent part by part.
  const known = source.size === undefined ? null : storedLengthOf(source.size)
  let staged: Blob[] | null = null
  let storedLength = known
  if (known === null || source.size! <= WHOLE_FILE_MAX_BYTES) {
    staged = []
    for (let part = await nextPart(); part; part = await nextPart())
      staged.push(new Blob([part], { type: ENCRYPTED_PART_TYPE }))
    storedLength = staged.reduce((sum, part) => sum + part.size, 0)
    if (known !== null && storedLength !== known)
      throw new Error('The data does not have the size it declared')
  }
  if (staged && storedLength! <= storedLengthOf(WHOLE_FILE_MAX_BYTES)) {
    const body = new FormData()
    for (const [name, value] of Object.entries({
      ...records,
      ...visibleOptions(options),
    }))
      if (value !== undefined) body.append(name, value ?? '')
    body.append(
      'file',
      new Blob(staged, { type: ENCRYPTED_PART_TYPE }),
      ENCRYPTED_PART_NAME
    )
    const reply = await send(
      'POST',
      '/api/files',
      body,
      { ...ENCRYPTED_HEADERS, ...selectionHeaders(options) },
      undefined,
      options.signal
    )
    if (!succeeded(reply))
      throw failure(reply, `Upload failed: ${reply.statusText}`)
    return result(reply.body)
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
  if (!succeeded(started)) throw failure(started, 'Failed to initialize upload')
  const id = field(field(started.body, 'data'), 'uploadId')
  if (typeof id !== 'string' || !id)
    throw new Error('Failed to initialize upload')
  const uploadId = encodeURIComponent(id)
  const parts: { ETag: string; PartNumber: number }[] = []
  let number = 0
  let sent = 0
  for (;;) {
    const part = staged ? (staged.shift() ?? null) : await nextPart()
    if (!part) break
    const reply = await send(
      'PUT',
      `/api/files/chunks/${uploadId}/part/${++number}`,
      part,
      ENCRYPTED_PART_HEADERS,
      undefined,
      options.signal
    )
    if (!succeeded(reply))
      throw failure(reply, `Upload failed: ${reply.statusText}`)
    const etag = field(field(reply.body, 'data'), 'etag')
    if (typeof etag !== 'string') throw new Error('Failed to parse response')
    parts.push({ ETag: etag, PartNumber: number })
    sent += part instanceof Blob ? part.size : part.length
  }
  if (sent !== storedLength)
    throw new Error('The data does not have the size it declared')
  const reply = await send(
    'POST',
    `/api/files/chunks/${uploadId}/complete`,
    JSON.stringify({ parts }),
    JSON_HEADERS,
    undefined,
    options.signal
  )
  if (!succeeded(reply)) throw failure(reply, 'Failed to complete upload')
  return result(reply.body)
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
  return (
    file.size > WHOLE_FILE_MAX_BYTES
      ? uploadInParts(file, options, onProgress)
      : uploadWhole(file, options, onProgress)
  ).then(plainUploaded(file, options))
}

/** Always one request, which the server checks for `pastes.create`. */
export async function uploadPaste(
  file: File,
  options: Pick<
    UploadOptions,
    'profileId' | 'visibility' | 'password' | 'encryptFor' | 'library'
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
  return plainUploaded<UploadResponse>(
    file,
    options
  )(parseUploadResponse(reply.body))
}
