import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { uploaderClientResponse } from '@/lib/uploads/uploader-clients/server'

const api = routes('/api/profile/spectacle', {
  failure: { message: 'Failed to generate Spectacle script' },
  logger: loggers.users,
})

export const POST = api((request) =>
  uploaderClientResponse('spectacle', request)
)
