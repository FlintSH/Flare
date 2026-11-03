import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import {
  SUBMISSION_KEY_HEADER,
  noStore,
  senderErrorResponse,
} from '@/lib/file-requests/http'
import { uploadRequestPart } from '@/lib/file-requests/uploads'
import { fileRequestPartLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Context = {
  params: Promise<{ token: string; uploadId: string; partNumber: string }>
}

/** Public: one part of a started file, as the raw request body. */
async function handlePUT(request: Request, context: Context) {
  const limited = await rateLimit(request, fileRequestPartLimiter)
  if (limited) return limited
  try {
    const { token, uploadId, partNumber } = await context.params
    if (!/^[a-z0-9]{1,100}$/.test(uploadId))
      return NextResponse.json(
        { error: 'Upload not found.', code: 'upload_not_found' },
        { status: 404, headers: noStore }
      )
    return NextResponse.json(
      await uploadRequestPart(
        token,
        request.headers.get(SUBMISSION_KEY_HEADER),
        uploadId,
        partNumber,
        request.body
      ),
      { headers: noStore }
    )
  } catch (error) {
    return senderErrorResponse(error)
  }
}

export async function PUT(request: Request, context: Context) {
  // Successful parts are routine; the file's completion is the audited event.
  return withAuditRoute(async () => handlePUT(request, context), {
    route: '/api/r/[token]/uploads/[uploadId]/parts/[partNumber]',
    skipSuccess: true,
  })(request)
}
