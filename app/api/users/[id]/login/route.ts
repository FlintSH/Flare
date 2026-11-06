import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/login', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const POST = api(async (request, { params }: Context) => {
  await requireSession('users.read')

  const { id } = await params
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      roles: true,
    },
  })

  if (!user) {
    throw new HttpError(404, 'User not found')
  }

  return user
})
