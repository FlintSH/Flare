import { requireAuth } from '@/lib/auth/api-auth'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { getStorageProvider } from '@/lib/storage'
import {
  completeChunkUpload,
  initializeChunkUpload,
  requireUploadMetadata,
  saveUploadMetadata,
} from '@/lib/uploads/chunks'
import { UploadError, uploadErrorResponse } from '@/lib/uploads/options'

export async function POST(req: Request) {
  const limited = await rateLimit(req, uploadLimiter)
  if (limited) return limited
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response
    return Response.json({ data: await initializeChunkUpload(req, user) })
  } catch (error) {
    return uploadErrorResponse(error)
  }
}

export async function PUT(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response
    const body = await req.json()
    if (typeof body.uploadId !== 'string')
      throw new UploadError('Upload ID is required.')
    return Response.json({
      data: await completeChunkUpload(user, body.uploadId, body),
    })
  } catch (error) {
    return uploadErrorResponse(error)
  }
}

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response
    const query = new URL(req.url).searchParams
    const id = query.get('uploadId')
    const part = Number(query.get('partNumber'))
    if (!id || !Number.isInteger(part) || part < 1 || part > 10000)
      throw new UploadError('Upload ID and valid part number are required.')
    const metadata = await requireUploadMetadata(user, id)
    const storage = await getStorageProvider()
    const url = await storage.getPresignedPartUploadUrl(
      metadata.fileKey,
      metadata.s3UploadId,
      part
    )
    metadata.lastActivity = Date.now()
    await saveUploadMetadata(id, metadata)
    return Response.json({ data: { url, presignedUrl: url } })
  } catch (error) {
    return uploadErrorResponse(error)
  }
}
