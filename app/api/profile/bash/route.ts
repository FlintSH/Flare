import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { uploaderClientResponse } from '@/lib/uploads/uploader-clients/server'

const api = routes('/api/profile/bash', {
  failure: { message: 'Failed to generate bash script' },
  logger: loggers.users,
})

export const GET = api((request) => uploaderClientResponse('bash', request))
