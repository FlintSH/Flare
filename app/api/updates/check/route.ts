import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { checkForUpdates, getBuildInfo } from '@/lib/releases'

const api = routes('/api/updates/check', {
  failure: { message: 'Failed to check for updates' },
  logger: loggers.api,
})

export const GET = api(async (request) => {
  await requireSession(request, 'settings.read')
  return checkForUpdates(getBuildInfo())
})
