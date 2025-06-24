import {
  CreateUrlResponse,
  CreateUrlSchema,
  UrlListResponse,
} from '@/types/dto/url'
import { nanoid } from 'nanoid'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { createRequestLogger, logError, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'

// Generate a 6-character random code
function generateShortCode() {
  return nanoid(6)
}

export async function POST(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()

  try {
    // Use standardized auth handler
    const { user, response } = await requireAuth(req)
    if (response) {
      logger.info('api', 'URL shortening failed - authentication required', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
      })
      requestLogger.complete(401)
      return response
    }

    const json = await req.json()

    // Validate request body
    const result = CreateUrlSchema.safeParse(json)
    if (!result.success) {
      logger.warn('api', 'URL shortening failed - validation error', {
        userId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
        metadata: {
          validationError: result.error.issues[0].message,
        },
      })
      requestLogger.complete(400, user.id)
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const { url } = result.data

    logger.info('api', 'URL shortening request started', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        targetUrl: url,
      },
    })

    // Generate a unique short code
    let shortCode = generateShortCode()
    let isUnique = false
    let attempts = 0
    while (!isUnique) {
      attempts++
      const existing = await prisma.shortenedUrl.findUnique({
        where: { shortCode },
      })
      if (!existing) {
        isUnique = true
      } else {
        shortCode = generateShortCode()
        if (attempts > 10) {
          logger.error(
            'api',
            'Failed to generate unique short code after 10 attempts',
            {
              userId: user.id,
              requestId: requestLogger.requestId,
            }
          )
          throw new Error('Failed to generate unique short code')
        }
      }
    }

    const shortenedUrl = await prisma.shortenedUrl.create({
      data: {
        shortCode,
        targetUrl: url,
        userId: user.id,
      },
    })

    const responseTime = Date.now() - startTime

    logger.info('api', 'URL shortened successfully', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        shortCode,
        targetUrl: url,
        shortenedUrlId: shortenedUrl.id,
      },
    })

    logger.userAction('URL shortened', user.id, {
      ipAddress: context.ipAddress,
      responseTime,
      metadata: {
        shortCode,
        targetUrl: url,
      },
    })

    requestLogger.complete(200, user.id, {
      shortCode,
    })

    // Return typed response
    return apiResponse<CreateUrlResponse>(shortenedUrl)
  } catch (error) {
    const responseTime = Date.now() - startTime

    logError('api', 'URL shortening failed', error as Error, {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, context.userId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function GET(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()

  try {
    // Use standardized auth handler
    const { user, response } = await requireAuth(req)
    if (response) {
      requestLogger.complete(401)
      return response
    }

    logger.debug('api', 'Retrieving user URLs', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
    })

    const urls = await prisma.shortenedUrl.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    const responseTime = Date.now() - startTime

    logger.info('api', 'URLs retrieved successfully', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        urlCount: urls.length,
      },
    })

    requestLogger.complete(200, user.id, {
      urlCount: urls.length,
    })

    // Return typed response
    return apiResponse<UrlListResponse>({ urls })
  } catch (error) {
    const responseTime = Date.now() - startTime

    logError('api', 'Failed to retrieve URLs', error as Error, {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, context.userId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
