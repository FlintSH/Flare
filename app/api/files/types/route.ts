import { FileTypesResponse } from '@/types/dto/file'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response

    // Get unique mime types for the user
    const files = await prisma.file.findMany({
      where: { userId: user.id },
      select: { mimeType: true },
      distinct: ['mimeType'],
    })

    const types = files.map((file) => file.mimeType).sort()

    return apiResponse<FileTypesResponse>({ types })
  } catch (error) {
    console.error('Error fetching file types:', error)
    return apiError(
      'Failed to fetch file types',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
