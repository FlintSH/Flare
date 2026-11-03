import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import {
  SUBMISSION_KEY_HEADER,
  noStore,
  senderErrorResponse,
} from '@/lib/file-requests/http'
import { startRequestUpload } from '@/lib/file-requests/uploads'
import { readRoleJson } from '@/lib/permissions/http'
import { fileRequestLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Context = { params: Promise<{ token: string }> }

/** Public: start one file. Every file, small or large, is sent in parts. */
async function handlePOST(request: Request, context: Context) {
  const limited = await rateLimit(request, fileRequestLimiter)
  if (limited) return limited
  const body = await readRoleJson(request, 'Upload request')
  if (body.response) return body.response
  try {
    const { token } = await context.params
    return NextResponse.json(
      await startRequestUpload(
        token,
        request.headers.get(SUBMISSION_KEY_HEADER),
        body.data
      ),
      { status: 201, headers: noStore }
    )
  } catch (error) {
    return senderErrorResponse(error)
  }
}

export async function POST(request: Request, context: Context) {
  return withAuditRoute(async () => handlePOST(request, context), {
    route: '/api/r/[token]/uploads',
  })(request)
}
