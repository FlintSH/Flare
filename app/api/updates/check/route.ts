import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { checkForUpdates, getBuildInfo } from '@/lib/releases'

const failed = 'Failed to check for updates'

const api = routes('/api/updates/check', {
  // The schema checks GitHub's answer, not the request: a mismatch is our failure.
  invalid: () => new HttpError(500, failed),
  failure: { message: failed },
  logger: loggers.api,
})

export const GET = api(async () => {
  await requireSession('settings.read')
  return checkForUpdates(getBuildInfo())
})
