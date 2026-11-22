import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'
import { findUserSummary } from '@/lib/users/admin'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/login', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const POST = api(async (request, { params }: Context) => {
  await requireSession(request, ADMIN_PERMISSIONS.getUser)

  const { id } = await params
  const user = await findUserSummary({ id })

  if (!user) {
    throw new HttpError(404, 'User not found')
  }

  return user
})
