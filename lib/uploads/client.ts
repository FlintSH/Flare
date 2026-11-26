import { TYPE_MISMATCH } from './refusals'
import { type UploadResponse, parseUploadResponse } from './response'
import type { UploadProfileOptions } from './schema'

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
  /**
   * A time after the upload, which the server counts from when the file
   * arrives. Omitted: the profile's. `expiresAt` takes precedence.
   */
  expiration?: Exclude<UploadProfileOptions['expiration'], undefined>
  /** Omitted: the profile's expiration. Null: no expiration. */
  expiresAt?: Date | null
  expiryAction?: 'DELETE' | 'SET_PRIVATE'
  /** Omitted: the profile's tags. Empty: none. */
  tagIds?: readonly string[]
}

/** Bytes of the file sent so far. */
type Progress = (uploaded: number) => void

/** Why an upload stopped when someone cancelled it, rather than a failure. */
export function uploadCancelled() {
  return new DOMException('Upload cancelled', 'AbortError')
}

export const isUploadCancelled = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

/** A refusal from the server, with its status, as opposed to a lost connection. */
export class UploadFailure extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'UploadFailure'
  }
}

/**
 * Whether a failure would happen to every file after it too: a lost
 * connection, a sign-in or role problem, too many requests, a full quota, a
 * server error. A
 * refusal of one file, such as its name or type, doesn't stop the rest.
 */
export function stopsEveryUpload(error: unknown) {
  if (!(error instanceof UploadFailure)) return true
  const { status, message } = error
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status >= 500 ||
    (status === 413 && /quota/i.test(message))
  )
}

/**
 * Whether Flare refused this file for something sending it again can't
 * change: contents that don't match its type, or a size over the per-file
 * limit. A proxy's bare 413 isn't one: an administrator can raise that.
 */
export function refusedForGood(error: unknown) {
  if (!(error instanceof UploadFailure) || stopsEveryUpload(error)) return false
  if (error.status === 413) return error.message !== REQUEST_TOO_LARGE
  return error.status === 400 && error.message.startsWith(TYPE_MISMATCH)
}

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
    if (signal?.aborted) return reject(uploadCancelled())
    const request = new XMLHttpRequest()
    const cancel = () => request.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const settle = () => signal?.removeEventListener('abort', cancel)
    if (onProgress)
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded)
      })
    request.addEventListener('load', () => {
      settle()
      resolve({
        status: request.status,
        statusText: request.statusText,
        body: readJson(request.responseText),
      })
    })
    request.addEventListener('error', () => {
      settle()
      reject(new Error(NETWORK_ERROR))
    })
    request.addEventListener('abort', () => {
      settle()
      reject(signal?.aborted ? uploadCancelled() : new Error(NETWORK_ERROR))
    })
    request.open(method, url)
    for (const [name, value] of Object.entries(headers))
      request.setRequestHeader(name, value)
    request.send(body)
  })
}

const succeeded = (reply: Reply) => reply.status >= 200 && reply.status < 300

function failure(reply: Reply, fallback: string) {
  const message = field(reply.body, 'error')
  return new UploadFailure(
    typeof message === 'string' && message
      ? message
      : reply.status === 413
        ? REQUEST_TOO_LARGE
        : fallback,
    reply.status
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
  if (options.expiration) body.append('expiration', options.expiration)
  if (options.expiresAt !== undefined)
    body.append('expiresAt', options.expiresAt?.toISOString() ?? '')
  if (options.expiryAction) body.append('expiryAction', options.expiryAction)
  if (options.tagIds) body.append('tagIds', JSON.stringify(options.tagIds))
  return body
}

async function uploadWhole(
  file: File,
  options: UploadOptions,
  onProgress?: Progress,
  signal?: AbortSignal
) {
  const reply = await send(
    'POST',
    '/api/files',
    multipartBody(file, options),
    selectionHeaders(options),
    onProgress,
    signal
  )
  if (!succeeded(reply))
    throw failure(reply, `Upload failed: ${reply.statusText}`)
  const uploaded = parseUploadResponse(reply.body)
  onProgress?.(file.size)
  return uploaded
}

async function startChunkedUpload(
  file: File,
  options: UploadOptions,
  signal?: AbortSignal
) {
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
      expiration: options.expiration,
      expiresAt:
        options.expiresAt === undefined
          ? undefined
          : (options.expiresAt?.toISOString() ?? null),
      expiryAction: options.expiryAction,
      tagIds: options.tagIds,
    }),
    JSON_HEADERS,
    undefined,
    signal
  )
  if (!succeeded(reply)) throw failure(reply, 'Failed to initialize upload')
  const session = field(reply.body, 'data')
  const uploadId = field(session, 'uploadId')
  if (typeof uploadId !== 'string' || !uploadId || !field(session, 'fileKey'))
    throw new Error('Failed to initialize upload')
  return encodeURIComponent(uploadId)
}

/**
 * A cancelled upload stops sending parts and asks the server to free the
 * ones it has.
 */
async function uploadInParts(
  file: File,
  options: UploadOptions,
  onProgress?: Progress,
  signal?: AbortSignal
) {
  const uploadId = await startChunkedUpload(file, options, signal)
  try {
    return await sendParts(file, uploadId, onProgress, signal)
  } catch (error) {
    // Free the parts sent so far rather than leave them for the hourly sweep.
    if (isUploadCancelled(error))
      void fetch(`/api/files/chunks/${uploadId}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch(() => {})
    throw error
  }
}

async function sendParts(
  file: File,
  uploadId: string,
  onProgress?: Progress,
  signal?: AbortSignal
) {
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
      signal
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
    if (failed) throw signal?.aborted ? uploadCancelled() : failed.reason
  }
  const reply = await send(
    'POST',
    `/api/files/chunks/${uploadId}/complete`,
    JSON.stringify({
      parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
    }),
    JSON_HEADERS,
    undefined,
    signal
  )
  if (!succeeded(reply)) throw failure(reply, 'Failed to complete upload')
  return parseUploadResponse(reply.body)
}

export function uploadFile(
  file: File,
  options: UploadOptions,
  onProgress?: Progress,
  signal?: AbortSignal
): Promise<UploadResponse> {
  return file.size > WHOLE_FILE_MAX_BYTES
    ? uploadInParts(file, options, onProgress, signal)
    : uploadWhole(file, options, onProgress, signal)
}

/** Always one request, which the server checks for `pastes.create`. */
export async function uploadPaste(
  file: File,
  options: UploadOptions
): Promise<UploadResponse> {
  const reply = await send('POST', '/api/files', multipartBody(file, options), {
    'X-Flare-Paste': 'true',
    ...selectionHeaders(options),
  })
  if (!succeeded(reply))
    throw failure(reply, 'Could not create your paste. Please try again.')
  return parseUploadResponse(reply.body)
}
