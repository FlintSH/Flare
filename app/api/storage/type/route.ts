import { getConfig } from '@/lib/config'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/storage/type', {
  failure: { message: 'Internal server error' },
  logger: loggers.storage,
})

// The backend the settings name, which is the only one Flare stores files in.
export const GET = api(async () => ({
  type: (await getConfig()).settings.general.storage.provider,
}))
