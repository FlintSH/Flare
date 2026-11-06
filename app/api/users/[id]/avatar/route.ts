import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { removeAvatar } from '@/lib/users/avatar'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/avatar', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const DELETE = api(async (request, { params }: Context) => {
  const { user: actor } = await requireSession(request, 'users.update')
  const { id } = await params

  await removeAvatar(actor.id, id)

  return new NextResponse(null, { status: 204 })
})
