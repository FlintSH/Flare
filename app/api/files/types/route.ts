import { FileTypesResponse } from '@/types/dto/file'

import { accountFileTypes } from '@/lib/files/list'
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

  const types = await accountFileTypes(user.id)

  return apiResponse<FileTypesResponse>({ types })
})

export const OPTIONS = preflight('token')
