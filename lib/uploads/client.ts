import { type UploadResponse, parseUploadResponse } from './response'

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
  onProgress?: Progress
) {
  return new Promise<Reply>((resolve, reject) => {
    const request = new XMLHttpRequest()
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
    request.addEventListener('abort', () => reject(new Error(NETWORK_ERROR)))
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
    onProgress
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
    JSON_HEADERS
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
      (bytes) => report(part, bytes)
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
    JSON_HEADERS
  )
  if (!succeeded(reply)) throw failure(reply, 'Failed to complete upload')
  return parseUploadResponse(reply.body)
}

export function uploadFile(
  file: File,
  options: UploadOptions,
  onProgress?: Progress
): Promise<UploadResponse> {
  return file.size > WHOLE_FILE_MAX_BYTES
    ? uploadInParts(file, options, onProgress)
    : uploadWhole(file, options, onProgress)
}

/** Always one request, which the server checks for `pastes.create`. */
export async function uploadPaste(
  file: File,
  options: Pick<UploadOptions, 'profileId' | 'visibility' | 'password'>
): Promise<UploadResponse> {
  const reply = await send('POST', '/api/files', multipartBody(file, options), {
    'X-Flare-Paste': 'true',
    ...selectionHeaders(options),
  })
  if (!succeeded(reply))
    throw failure(reply, 'Could not create your paste. Please try again.')
  return parseUploadResponse(reply.body)
}
