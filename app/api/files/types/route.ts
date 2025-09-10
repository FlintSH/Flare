import { FileTypesResponse } from '@/types/dto/file'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'

const logger = loggers.files

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response

    const files = await prisma.file.findMany({
      where: { userId: user.id },
      select: { mimeType: true },
      distinct: ['mimeType'],
    })

    const types = files.map((file) => file.mimeType).sort()

    return apiResponse<FileTypesResponse>({ types })
  } catch (error) {
    logger.error('Error fetching file types:', error as Error)
    return apiError(
      'Failed to fetch file types',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
