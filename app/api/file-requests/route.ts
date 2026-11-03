import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { noStore, ownerErrorResponse } from '@/lib/file-requests/http'
import {
  fileRequestCreateSchema,
  fileRequestListQuerySchema,
} from '@/lib/file-requests/policy'
import {
  createFileRequest,
  listFileRequests,
} from '@/lib/file-requests/service'
import { hasPermission } from '@/lib/permissions/catalog'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'

/** Session-only: named and legacy API tokens never manage file requests. */
async function requester() {
  const session = await getAccessSession()
  if (!session?.user)
    return {
      response: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401, headers: noStore }
      ),
    }
  if (!hasPermission(session.user, 'fileRequests.manage'))
    return {
      response: NextResponse.json(
        { error: 'Permission denied' },
        { status: 403, headers: noStore }
      ),
    }
  return { userId: session.user.id }
}

async function handleGET(request: Request) {
  const owner = await requester()
  if (owner.response) return owner.response
  const parsed = fileRequestListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Choose a valid status, page, and limit' },
      { status: 400, headers: noStore }
    )
  try {
    return NextResponse.json(
      await listFileRequests(owner.userId, parsed.data),
      {
        headers: noStore,
      }
    )
  } catch (error) {
    return ownerErrorResponse(error, 'Could not load file requests')
  }
}

async function handlePOST(request: Request) {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const owner = await requester()
  if (owner.response) return owner.response
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request, 'File request')
  if (body.response) return body.response
  try {
    const input = fileRequestCreateSchema.parse(body.data)
    return NextResponse.json(
      { request: await createFileRequest(owner.userId, input) },
      { status: 201, headers: noStore }
    )
  } catch (error) {
    return ownerErrorResponse(error, 'Could not create the file request')
  }
}

export async function GET(request: Request) {
  return withAuditRoute(async () => handleGET(request), {
    route: '/api/file-requests',
  })(request)
}

export async function POST(request: Request) {
  return withAuditRoute(async () => handlePOST(request), {
    route: '/api/file-requests',
  })(request)
}
