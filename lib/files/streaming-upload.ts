import busboy from 'busboy'
import { Readable } from 'node:stream'

import type { StorageProvider } from '@/lib/storage'

export type UploadLimit = 'size' | 'quota' | null

export interface ResolvedDestination {
  filePath: string
  urlPath: string
  displayName: string
  urlSafeName: string
}

export interface ParsedUpload extends ResolvedDestination {
  mimeType: string
  size: number
}

export interface ParseUploadResult {
  upload: ParsedUpload | null
  fields: Record<string, string>
  limitHit: UploadLimit
}

interface ParseUploadOptions {
  req: Request
  storageProvider: StorageProvider
  // The largest file the configured settings will allow.
  maxBytes: number
  // The largest file the user's remaining quota will allow (Infinity when unlimited).
  quotaLimitBytes: number
  // Resolves the destination once the multipart filename is known. The file is
  // never fully buffered, so this runs before the body is streamed to storage.
  resolveDestination: (info: {
    filename: string
    mimeType: string
  }) => Promise<ResolvedDestination>
}

/**
 * Parses a multipart/form-data request containing a single file and streams the
 * file directly to storage without buffering it in memory. Other form fields are
 * collected and returned alongside the file metadata.
 */
export async function parseSingleFileUpload({
  req,
  storageProvider,
  maxBytes,
  quotaLimitBytes,
  resolveDestination,
}: ParseUploadOptions): Promise<ParseUploadResult> {
  const contentType = req.headers.get('content-type') || ''
  const effectiveLimit = Math.min(maxBytes, quotaLimitBytes)
  const quotaIsBinding = quotaLimitBytes < maxBytes

  if (!req.body) {
    throw new Error('Request has no body')
  }

  const nodeStream = Readable.fromWeb(
    req.body as unknown as Parameters<typeof Readable.fromWeb>[0]
  )

  return await new Promise<ParseUploadResult>((resolve, reject) => {
    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fileSize: effectiveLimit },
    })

    const fields: Record<string, string> = {}
    let upload: ParsedUpload | null = null
    let filePromise: Promise<void> = Promise.resolve()
    let limitHit: UploadLimit = null
    let settled = false

    const finish = (result: ParseUploadResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const fail = (error: Error) => {
      if (settled) return
      // A stream/parse error after we already detected an oversized upload is
      // expected (we abort the request on purpose), so surface the limit instead.
      if (limitHit) {
        settled = true
        resolve({ upload: null, fields, limitHit })
        return
      }
      settled = true
      reject(error)
    }

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (name, fileStream, info) => {
      if (name !== 'file') {
        fileStream.resume()
        return
      }

      const mimeType = info.mimeType || 'application/octet-stream'

      filePromise = (async () => {
        const destination = await resolveDestination({
          filename: info.filename || 'file',
          mimeType,
        })

        fileStream.on('limit', () => {
          limitHit = quotaIsBinding ? 'quota' : 'size'
          // Abort the in-progress storage write and stop reading the client.
          fileStream.destroy(new Error('FILE_SIZE_LIMIT'))
          nodeStream.unpipe(bb)
          nodeStream.destroy()
          filePromise
            .catch(() => {})
            .then(() => finish({ upload: null, fields, limitHit }))
        })

        const { size } = await storageProvider.uploadStream(
          fileStream,
          destination.filePath,
          mimeType
        )

        upload = { ...destination, mimeType, size }
      })()

      filePromise.catch(() => {})
    })

    bb.on('error', (error) => fail(error as Error))

    bb.on('close', () => {
      filePromise
        .then(() => finish({ upload, fields, limitHit }))
        .catch((error) => fail(error as Error))
    })

    nodeStream.on('error', (error) => fail(error as Error))
    nodeStream.pipe(bb)
  })
}
