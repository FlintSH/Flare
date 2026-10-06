import { withAuditRoute } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/api-auth'
import { completeChunkUpload } from '@/lib/uploads/chunks'
import { uploadErrorResponse } from '@/lib/uploads/options'

async function handlePOST(
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  return withAuditRoute(async () => handlePOST(req, { params }), {
    route: '/api/files/chunks/[uploadId]/complete',
  })(req)
}
