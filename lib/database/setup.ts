import { loggers } from '@/lib/logger'

import { prisma } from './prisma'

const logger = loggers.db

export async function checkSetupCompletion(): Promise<boolean> {
  try {
    const userCount = await prisma.user.count()
    logger.debug('Setup check completed', { userCount, isSetup: userCount > 0 })
    return userCount > 0
  } catch (error) {
    logger.error('Setup check failed', error as Error)
    return false
  }
}
