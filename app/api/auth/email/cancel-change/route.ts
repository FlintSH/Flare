import { prisma } from '@/lib/database/prisma'
import { lockEmailUser } from '@/lib/email/account'
import { emailRoute, emailSession } from '@/lib/email/http'

export async function POST(req: Request) {
  return emailRoute(async () => {
    const { user } = await emailSession(req)
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
}
