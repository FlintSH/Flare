import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
import { routes } from '@/lib/http/route'
import { abandonChunkUpload } from '@/lib/uploads/chunks'
import { uploadRoutes } from '@/lib/uploads/http'

type Context = { params: Promise<{ uploadId: string }> }

const api = routes('/api/files/chunks/[uploadId]', uploadRoutes)

/** Cancels a chunked upload that hasn't been completed, freeing its parts. */
export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { uploadId } = await params
  await abandonChunkUpload(user, uploadId)
  return { data: { cancelled: true } }
})

export const OPTIONS = preflight('token')
