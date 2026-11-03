import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { noStore, ownerErrorResponse } from '@/lib/file-requests/http'
import { fileRequestUpdateSchema } from '@/lib/file-requests/policy'
import {
  deleteFileRequest,
  getFileRequest,
  updateFileRequest,
} from '@/lib/file-requests/service'
import { hasPermission } from '@/lib/permissions/catalog'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }

/** Session-only: named and legacy API tokens never manage file requests. */
async function requester(context: Context) {
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
  const { id } = await context.params
  if (!id || id.length > 128)
    return {
      response: NextResponse.json(
        { error: 'File request not found.' },
        { status: 404, headers: noStore }
      ),
    }
  return { userId: session.user.id, id }
}

async function handleGET(request: Request, context: Context) {
  const owner = await requester(context)
  if (owner.response) return owner.response
  const page = Number(new URL(request.url).searchParams.get('page') || '1')
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    return NextResponse.json(
      { error: 'Page must be a positive integer' },
      { status: 400, headers: noStore }
    )
  try {
    return NextResponse.json(
      await getFileRequest(owner.userId, owner.id, page),
      {
        headers: noStore,
      }
    )
  } catch (error) {
    return ownerErrorResponse(error, 'Could not load the file request')
  }
}

async function handlePATCH(request: Request, context: Context) {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const owner = await requester(context)
  if (owner.response) return owner.response
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request, 'File request')
  if (body.response) return body.response
  try {
    const input = fileRequestUpdateSchema.parse(body.data)
    return NextResponse.json(
      { request: await updateFileRequest(owner.userId, owner.id, input) },
      { headers: noStore }
    )
  } catch (error) {
    return ownerErrorResponse(error, 'Could not update the file request')
  }
}

async function handleDELETE(request: Request, context: Context) {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const owner = await requester(context)
  if (owner.response) return owner.response
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  try {
    await deleteFileRequest(owner.userId, owner.id)
    return NextResponse.json({ deleted: true }, { headers: noStore })
  } catch (error) {
    return ownerErrorResponse(error, 'Could not delete the file request')
  }
}

export async function GET(request: Request, context: Context) {
  return withAuditRoute(async () => handleGET(request, context), {
    route: '/api/file-requests/[id]',
  })(request)
}

export async function PATCH(request: Request, context: Context) {
  return withAuditRoute(async () => handlePATCH(request, context), {
    route: '/api/file-requests/[id]',
  })(request)
}

export async function DELETE(request: Request, context: Context) {
  return withAuditRoute(async () => handleDELETE(request, context), {
    route: '/api/file-requests/[id]',
  })(request)
}
