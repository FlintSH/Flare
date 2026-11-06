import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { uploaderClientResponse } from '@/lib/uploads/uploader-clients/server'

const api = routes('/api/profile/sharex', {
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api((request) => uploaderClientResponse('sharex', request))
