import { NextResponse } from 'next/server'

import { revokeSecuritySessions } from '@/lib/auth/security/service'
import { requireSession } from '@/lib/http/access'
import { assertSameOrigin } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { mutateAccount } from '@/lib/permissions/account-mutations'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/sessions', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const DELETE = api(async (request, { params }: Context) => {
  assertSameOrigin(request)
  const { user } = await requireSession('users.sessions')

  const { id } = await params

  await mutateAccount(user.id, id, 'users.sessions', (tx) =>
    revokeSecuritySessions(tx, id)
  )

  return new NextResponse(null, { status: 204 })
})
