import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { completeChunkUpload } from '@/lib/uploads/chunks'
import { uploadRoutes } from '@/lib/uploads/http'

type Context = { params: Promise<{ uploadId: string }> }

const api = routes('/api/files/chunks/[uploadId]/complete', uploadRoutes)

export const POST = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { uploadId } = await params
  // Keep the established unwrapped response of this completion endpoint.
  return completeChunkUpload(user, uploadId, await readJson(request))
})

export const OPTIONS = preflight('token')
