import { FileTypesResponse } from '@/types/dto/file'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { withAuditRoute } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'

const logger = loggers.files

async function handleGET(request: Request) {
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

export async function GET(request: Request) {
  return withAuditRoute(async () => handleGET(request), {
    route: '/api/files/types',
  })(request)
}
