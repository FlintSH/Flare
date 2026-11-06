import { requireAccount } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import {
  getUploadStorage,
  requireUploadMetadata,
  saveUploadMetadata,
  withUploadLock,
} from '@/lib/uploads/chunks'
import { uploadRoutes } from '@/lib/uploads/http'
import { UploadError } from '@/lib/uploads/options'

type Context = { params: Promise<{ uploadId: string; partNumber: string }> }
function validPart(value: string) {
  const part = Number(value)
  if (!Number.isInteger(part) || part < 1 || part > 10000)
    throw new UploadError('Invalid part number.')
  return part
}

const api = routes(
  '/api/files/chunks/[uploadId]/part/[partNumber]',
  uploadRoutes
)

export const GET = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { uploadId, partNumber } = await params
  const part = validPart(partNumber)
  const metadata = await requireUploadMetadata(user, uploadId)
  const storage = await getUploadStorage(metadata)
  const url = await storage.getPresignedPartUploadUrl(
    metadata.fileKey,
    metadata.s3UploadId,
    part
  )
  metadata.lastActivity = Date.now()
  await saveUploadMetadata(uploadId, metadata)
  return { data: { url } }
})

export const PUT = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { uploadId, partNumber } = await params
  const part = validPart(partNumber)
  const metadata = await requireUploadMetadata(user, uploadId)
  if (!request.body) throw new UploadError('No upload part provided.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > Math.min(metadata.totalSize, 64 * 1024 * 1024)) {
        await reader.cancel()
        throw new UploadError('Upload parts must be at most 64 MB.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const storage = await getUploadStorage(metadata)
  const result = await withUploadLock(uploadId, async (transaction) => {
    await requireUploadMetadata(user, uploadId, transaction)
    if (
      await transaction.file.findFirst({
        where: { path: metadata.fileKey },
        select: { id: true },
      })
    )
      throw new UploadError('This upload is already complete.', 409)
    const result = await storage.uploadPart(
      metadata.fileKey,
      metadata.s3UploadId,
      part,
      Buffer.concat(chunks)
    )
    metadata.lastActivity = Date.now()
    await saveUploadMetadata(uploadId, metadata)
    return result
  })
  return { data: { etag: result.ETag } }
})
