import { NextResponse } from 'next/server'

import { setAuditTarget, withAuditRoute } from '@/lib/audit'
import { noStore, senderErrorResponse } from '@/lib/file-requests/http'
import { submissionCreateSchema } from '@/lib/file-requests/policy'
import { createSubmission } from '@/lib/file-requests/service'
import { readRoleJson } from '@/lib/permissions/http'
import { fileRequestLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ token: string }> }

/** Public: anyone with the request link starts a batch of files here. */
async function handlePOST(request: Request, context: Context) {
  const limited = await rateLimit(request, fileRequestLimiter)
  if (limited) return limited
  const body = await readRoleJson(request, 'Submission')
  if (body.response) return body.response
  try {
    const { token } = await context.params
    const input = submissionCreateSchema.parse(body.data ?? {})
    const result = await createSubmission(token, input)
    setAuditTarget({
      type: 'file_request_submission',
      id: result.submission.id,
    })
    return NextResponse.json(result, { status: 201, headers: noStore })
  } catch (error) {
    return senderErrorResponse(error)
  }
}

export async function POST(request: Request, context: Context) {
  return withAuditRoute(async () => handlePOST(request, context), {
    route: '/api/r/[token]/submissions',
  })(request)
}
