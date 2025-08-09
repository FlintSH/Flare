import { getServerSession } from 'next-auth'

import { apiError, apiResponse } from '@/lib/api/response'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

export async function DELETE(
  _request: Request,
  { params }: { params: { accountId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return apiError('Unauthorized', 401)
    }

    const { accountId } = params

    // Check if the account belongs to the user
    const account = await prisma.account.findFirst({
      where: {
        id: accountId,
        userId: session.user.id,
      },
    })

    if (!account) {
      return apiError('Account not found', 404)
    }

    // Check if user has other authentication methods
    const accountCount = await prisma.account.count({
      where: {
        userId: session.user.id,
      },
    })

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    })

    const hasPassword = !!user?.password
    const hasOtherAccounts = accountCount > 1

    if (!hasPassword && !hasOtherAccounts) {
      return apiError(
        'Cannot disconnect the only authentication method. Add a password or connect another account first.',
        400
      )
    }

    // Delete the account
    await prisma.account.delete({
      where: { id: accountId },
    })

    return apiResponse({ success: true })
  } catch (error) {
    console.error('Failed to disconnect account:', error)
    return apiError('Internal server error', 500)
  }
}
