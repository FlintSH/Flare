import { z } from 'zod'

import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import {
  completeChunkUpload,
  getUploadStorage,
  initializeChunkUpload,
  requireUploadMetadata,
  saveUploadMetadata,
} from '@/lib/uploads/chunks'
import { uploadRoutes } from '@/lib/uploads/http'
import { UploadError } from '@/lib/uploads/options'

const api = routes('/api/files/chunks', uploadRoutes)

export const POST = api(async (request) => {
  const limited = await rateLimit(request, uploadLimiter)
  if (limited) return limited
  const user = await requireAccount(request)
  return { data: await initializeChunkUpload(request, user) }
})

/** The completion names its upload; `completeChunkUpload` reads the rest. */
const completion = z.looseObject({ uploadId: z.string() })

export const PUT = api(async (request) => {
  const user = await requireAccount(request)
  const body = await readJson(request)
  const named = completion.safeParse(body)
  if (!named.success) throw new UploadError('Upload ID is required.')
  return { data: await completeChunkUpload(user, named.data.uploadId, body) }
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const query = new URL(request.url).searchParams
  const id = query.get('uploadId')
  const part = Number(query.get('partNumber'))
  if (!id || !Number.isInteger(part) || part < 1 || part > 10000)
    throw new UploadError('Upload ID and valid part number are required.')
  const metadata = await requireUploadMetadata(user, id)
  const storage = await getUploadStorage(metadata)
  const url = await storage.getPresignedPartUploadUrl(
    metadata.fileKey,
    metadata.s3UploadId,
    part
  )
  metadata.lastActivity = Date.now()
  await saveUploadMetadata(id, metadata)
  return { data: { url, presignedUrl: url } }
})

export const OPTIONS = preflight('token')
