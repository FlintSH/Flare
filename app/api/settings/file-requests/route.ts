import { NextResponse } from 'next/server'

import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import {
  everyoneCanRequestFiles,
  setEveryoneCanRequestFiles,
} from '@/lib/file-requests/service'
import { hasPermission } from '@/lib/permissions/catalog'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { PermissionError } from '@/lib/permissions/server'

const headers = { 'Cache-Control': 'private, no-store' }
const policySchema = z.object({ everyoneCanRequestFiles: z.boolean() }).strict()

async function handleGET() {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    )
  if (!hasPermission(session.user, 'settings.read'))
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403, headers }
    )
  return NextResponse.json(
    { everyoneCanRequestFiles: await everyoneCanRequestFiles() },
    { headers }
  )
}

async function handlePUT(request: Request) {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    )
  if (!hasPermission(session.user, 'settings.general'))
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403, headers }
    )
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request, 'File request settings request')
  if (body.response) return body.response
  const parsed = policySchema.safeParse(body.data)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Provide everyoneCanRequestFiles as true or false' },
      { status: 400, headers }
    )
  try {
    return NextResponse.json(
      await setEveryoneCanRequestFiles(
        session.user.id,
        parsed.data.everyoneCanRequestFiles
      ),
      { headers }
    )
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers }
      )
    console.error('Could not update file request settings', error)
    return NextResponse.json(
      { error: 'Could not update file request settings' },
      { status: 500, headers }
    )
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/settings/file-requests',
  })()
}

export async function PUT(request: Request) {
  return withAuditRoute(async () => handlePUT(request), {
    route: '/api/settings/file-requests',
  })(request)
}
