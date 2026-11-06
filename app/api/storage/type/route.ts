import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.storage

const api = routes('/api/storage/type', {
  failure: { message: 'Internal server error' },
  logger,
})

export const GET = api(async () => {
  try {
    const storageProvider = await getStorageProvider()
    return { type: storageProvider.kind }
  } catch (error) {
    logger.error('Failed to get storage type:', error as Error)
    return { type: 'local' }
  }
})
