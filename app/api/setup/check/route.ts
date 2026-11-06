import { checkSetupCompletion } from '@/lib/database/setup'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/setup/check', {
  failure: { message: 'Internal server error' },
  logger: loggers.startup,
})

// checkSetupCompletion answers false itself when the database can't be read.
export const GET = api(async () => ({
  completed: await checkSetupCompletion(),
}))
