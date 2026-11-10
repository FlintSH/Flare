import { FileTypesResponse } from '@/types/dto/file'

import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/types', {
  envelope: 'api',
  failure: { message: 'Failed to fetch file types' },
  logger: loggers.files,
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)

  const files = await prisma.file.findMany({
    // The types of plain files. The server has no type for an encrypted
    // file: the owner's browser adds the ones it opened.
    where: { userId: user.id, encrypted: false },
    select: { mimeType: true },
    distinct: ['mimeType'],
  })

  const types = files.map((file) => file.mimeType).sort()

  return apiResponse<FileTypesResponse>({ types })
})

export const OPTIONS = preflight('token')
