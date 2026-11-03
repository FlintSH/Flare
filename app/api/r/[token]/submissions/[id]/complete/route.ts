import { NextResponse } from 'next/server'

import { setAuditTarget, withAuditRoute } from '@/lib/audit'
import {
  SUBMISSION_KEY_HEADER,
  noStore,
  senderErrorResponse,
} from '@/lib/file-requests/http'
import { completeSubmission } from '@/lib/file-requests/uploads'
import { fileRequestLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ token: string; id: string }> }

/** Public: the sender finished. The owner may get one notification for the batch. */
async function handlePOST(request: Request, context: Context) {
  const limited = await rateLimit(request, fileRequestLimiter)
  if (limited) return limited
  try {
    const { token, id } = await context.params
    setAuditTarget({ type: 'file_request_submission', id })
    return NextResponse.json(
      await completeSubmission(
        token,
        request.headers.get(SUBMISSION_KEY_HEADER),
        id
      ),
      { headers: noStore }
    )
  } catch (error) {
    return senderErrorResponse(error)
  }
}

export async function POST(request: Request, context: Context) {
  return withAuditRoute(async () => handlePOST(request, context), {
    route: '/api/r/[token]/submissions/[id]/complete',
  })(request)
}
