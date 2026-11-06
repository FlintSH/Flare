import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/urls/[id]', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.api,
})

export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)

  const { id } = await params

  const url = await prisma.shortenedUrl.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!url) {
    throw new HttpError(404, 'URL not found')
  }

  if (url.userId !== user.id) {
    throw new HttpError(403, 'Unauthorized')
  }

  await prisma.shortenedUrl.delete({
    where: { id },
  })

  return new Response(null, { status: 204 })
})
