import { getServerSession } from 'next-auth'

import { apiError, apiResponse } from '@/lib/api/response'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return apiError('Unauthorized', 401)
    }

    const accounts = await prisma.account.findMany({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        type: true,
      },
    })

    return apiResponse(accounts)
  } catch (error) {
    console.error('Failed to fetch connected accounts:', error)
    return apiError('Internal server error', 500)
  }
}
