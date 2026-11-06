import { prisma } from '@/lib/database/prisma'
import { lockEmailUser } from '@/lib/email/account'
import { emailRoutes, emailSession } from '@/lib/email/http'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/email/cancel-change', emailRoutes)

export const POST = api(async (request) => {
  const { user } = await emailSession(request)
  await prisma.$transaction(async (tx) => {
    await lockEmailUser(tx, user.id)
    await tx.user.update({
      where: { id: user.id },
      data: { pendingEmail: null, pendingEmailOldConfirmed: false },
    })
    await tx.emailToken.updateMany({
      where: {
        userId: user.id,
        purpose: { in: ['change', 'change_approval'] },
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    })
  })
  return { message: 'The pending email change was canceled.' }
})
