import { requireAuth } from '@/lib/auth/api-auth'
import { completeChunkUpload } from '@/lib/uploads/chunks'
import { uploadErrorResponse } from '@/lib/uploads/options'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response
    const { uploadId } = await params
    // Keep the established unwrapped response of this completion endpoint.
    return Response.json(
      await completeChunkUpload(user, uploadId, await req.json())
    )
  } catch (error) {
    return uploadErrorResponse(error)
  }
}
