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

  // Step through the (userId, mimeType) index from one type to the next. A
  // library has a handful of types, so this reads a row for each of them
  // rather than every file.
  const rows = await prisma.$queryRaw<{ mimeType: string }[]>`
    WITH RECURSIVE types AS (
      (SELECT "mimeType" FROM "File" WHERE "userId" = ${user.id}
        ORDER BY "mimeType" LIMIT 1)
      UNION ALL
      SELECT (SELECT next."mimeType" FROM "File" next
        WHERE next."userId" = ${user.id} AND next."mimeType" > types."mimeType"
        ORDER BY next."mimeType" LIMIT 1)
      FROM types WHERE types."mimeType" IS NOT NULL
    )
    SELECT "mimeType" FROM types WHERE "mimeType" IS NOT NULL
  `

  const types = rows.map((row) => row.mimeType).sort()

  return apiResponse<FileTypesResponse>({ types })
})

export const OPTIONS = preflight('token')
