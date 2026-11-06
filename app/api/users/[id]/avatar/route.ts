import { NextResponse } from 'next/server'

import { Prisma } from '@prisma/client'

import { lockUserRow } from '@/lib/database/locks'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { queueAvatarStorageDeletion } from '@/lib/storage/deletion'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/avatar', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const DELETE = api(async (request, { params }: Context) => {
  const { user: actor } = await requireSession(request, 'users.update')
  const { id } = await params

  await mutateAccount(actor.id, id, 'users.update', async (tx) => {
    await lockUserRow(tx, id)
    const user = await tx.user.findUnique({ where: { id } })
    if (!user) throw new PermissionError('User not found', 404)
    await queueAvatarStorageDeletion(tx, user)
    await tx.user.update({
      where: { id },
      data: {
        image: null,
        avatarStoragePath: null,
        avatarStorageTarget: Prisma.DbNull,
      },
    })
  })

  return new NextResponse(null, { status: 204 })
})
