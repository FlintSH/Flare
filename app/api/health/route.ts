import { apiResponse } from '@/lib/api/response'
import { createRequestLogger, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'

// this endpoint can be used as a health check if
// you want to set that up with your deployment
export async function GET(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)

  try {
    const startTime = Date.now()
    const responseTime = Date.now() - startTime

    logger.debug('system', 'Health check performed', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(200, undefined, {
      status: 'healthy',
    })

    return apiResponse({ status: 'ok' })
  } catch (error) {
    logger.error('system', 'Health check failed', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      error: {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    })

    requestLogger.complete(500, undefined, {
      status: 'unhealthy',
    })

    return apiResponse({ status: 'error' })
  }
}
