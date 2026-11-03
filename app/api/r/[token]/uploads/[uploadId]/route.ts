import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import {
  SUBMISSION_KEY_HEADER,
  noStore,
  senderErrorResponse,
} from '@/lib/file-requests/http'
import { cancelRequestUpload } from '@/lib/file-requests/uploads'
import { fileRequestLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Context = { params: Promise<{ token: string; uploadId: string }> }

/** Public: give up on a started file and release its room in the request. */
async function handleDELETE(request: Request, context: Context) {
  const limited = await rateLimit(request, fileRequestLimiter)
  if (limited) return limited
  try {
    const { token, uploadId } = await context.params
    if (!/^[a-z0-9]{1,100}$/.test(uploadId))
      return NextResponse.json(
        { error: 'Upload not found.', code: 'upload_not_found' },
        { status: 404, headers: noStore }
      )
    return NextResponse.json(
      await cancelRequestUpload(
        token,
        request.headers.get(SUBMISSION_KEY_HEADER),
        uploadId
      ),
      { headers: noStore }
    )
  } catch (error) {
    return senderErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  return withAuditRoute(async () => handleDELETE(request, context), {
    route: '/api/r/[token]/uploads/[uploadId]',
  })(request)
}
