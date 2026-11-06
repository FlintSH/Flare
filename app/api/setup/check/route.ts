import { unavailable } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { isSetupComplete } from '@/lib/setup/status'

const message = 'Setup status is temporarily unavailable'

const api = routes('/api/setup/check', {
  failure: { message },
  logger: loggers.startup,
})

export const GET = api(async () => ({
  // Reading the accounts is all this route does, so a failure means the
  // database is unavailable. Answering "not set up" would send visitors to
  // the first-run wizard.
  completed: await isSetupComplete().catch(unavailable(message)),
}))
