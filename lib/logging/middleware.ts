import { NextResponse } from 'next/server'

import { createRequestLogger, logError, logger } from './index'

export interface ApiHandlerConfig {
  requireAuth?: boolean
  category?: 'api' | 'auth' | 'upload' | 'database' | 'system' | 'user'
  logLevel?: 'info' | 'debug'
  skipRequestLogging?: boolean
  skipResponseLogging?: boolean
}

export function withLogging<T extends any[]>(
  handler: (...args: T) => Promise<Response | NextResponse>,
  config: ApiHandlerConfig = {}
) {
  return async (...args: T): Promise<Response | NextResponse> => {
    const req = args[0] as Request
    const { category = 'api', logLevel = 'info' } = config

    let requestLogger: ReturnType<typeof createRequestLogger> | null = null
    let userId: string | undefined

    try {
      // Initialize request logging
      if (!config.skipRequestLogging) {
        requestLogger = createRequestLogger(req)
      }

      // Execute the handler
      const response = await handler(...args)

      // Extract user ID from response if available
      if (response instanceof NextResponse) {
        const responseBody = await response.clone().text()
        try {
          const jsonBody = JSON.parse(responseBody)
          userId = jsonBody.user?.id || jsonBody.userId
        } catch {
          // Not JSON or no user info
        }
      }

      // Log successful response
      if (requestLogger && !config.skipResponseLogging) {
        requestLogger.complete(response.status, userId)
      }

      return response
    } catch (error) {
      // Log error
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      logError(category, `API handler error: ${errorMessage}`, error as Error, {
        userId,
        endpoint: new URL(req.url).pathname,
        method: req.method,
      })

      // Log error response
      if (requestLogger && !config.skipResponseLogging) {
        requestLogger.complete(500, userId, { error: errorMessage })
      }

      // Return error response
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
  }
}

export function createApiLogger(endpoint: string, method: string) {
  return {
    info: (message: string, metadata?: Record<string, any>) => {
      logger.info('api', message, { endpoint, method, ...metadata })
    },
    warn: (message: string, metadata?: Record<string, any>) => {
      logger.warn('api', message, { endpoint, method, ...metadata })
    },
    error: (message: string, error?: Error, metadata?: Record<string, any>) => {
      logger.error('api', message, {
        endpoint,
        method,
        error: error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : undefined,
        ...metadata,
      })
    },
    debug: (message: string, metadata?: Record<string, any>) => {
      logger.debug('api', message, { endpoint, method, ...metadata })
    },
  }
}

// Helper to extract user context from request
export async function extractUserContext(req: Request): Promise<{
  userId?: string
  sessionId?: string
  ipAddress: string
  userAgent: string
}> {
  const ipAddress =
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  const userAgent = req.headers.get('user-agent') || 'unknown'

  // Try to extract session info from headers or body
  let userId: string | undefined
  let sessionId: string | undefined

  try {
    const authHeader = req.headers.get('authorization')
    if (authHeader) {
      // Extract session info from auth header if needed
      // This depends on your auth implementation
    }

    // Try to extract from body for POST requests
    if (
      req.method === 'POST' &&
      req.headers.get('content-type')?.includes('application/json')
    ) {
      const body = await req.clone().json()
      userId = body.userId
    }
  } catch {
    // Ignore errors in context extraction
  }

  return {
    userId,
    sessionId,
    ipAddress,
    userAgent,
  }
}

// Enhanced error logging with context
export function logApiError(
  endpoint: string,
  method: string,
  error: Error,
  context?: {
    userId?: string
    statusCode?: number
    requestBody?: any
    metadata?: Record<string, any>
  }
) {
  logger.error('api', `${method} ${endpoint} failed`, {
    endpoint,
    method,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  })
}

// Success logging with metrics
export function logApiSuccess(
  endpoint: string,
  method: string,
  statusCode: number,
  responseTime: number,
  context?: {
    userId?: string
    metadata?: Record<string, any>
  }
) {
  logger.info('api', `${method} ${endpoint} success`, {
    endpoint,
    method,
    statusCode,
    responseTime,
    ...context,
  })
}
