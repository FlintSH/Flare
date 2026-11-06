import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { deleteAccountWithStorageCleanup } from '@/lib/storage/deletion'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const DELETE = api(async (request, { params }: Context) => {
  const { user } = await requireSession(request, 'users.delete')
  const { id } = await params
  await deleteAccountWithStorageCleanup(user.id, id, 'users.delete')
  return new NextResponse(null, { status: 204 })
})
