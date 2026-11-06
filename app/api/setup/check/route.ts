import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { isSetupComplete } from '@/lib/setup/status'

const api = routes('/api/setup/check', {
  // Reading the accounts is all this route does, so a failure means the
  // database is unavailable. Answering "not set up" would send visitors to
  // the first-run wizard.
  failure: { status: 503, message: 'Setup status is temporarily unavailable' },
  logger: loggers.startup,
})

export const GET = api(async () => ({
  completed: await isSetupComplete(),
}))
