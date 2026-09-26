import { NextRequest, NextResponse } from 'next/server'

import { getAccessSession } from '@/lib/auth'
import { loggers } from '@/lib/logger'
import { LoggingContext } from '@/lib/logger/middleware'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'

const logger = loggers.api

interface ApiHandlerOptions {
  requireAuth?: boolean
  permission?: Permission
  loggerName?: string
}

interface ApiContext extends LoggingContext {
  user?: {
    id: string
    email: string
    permissions?: string[]
  }
  session?: {
    user: {
      id: string
      email: string
      permissions?: string[]
    }
    sessionToken?: string
  }
}

type ApiHandler<T = unknown> = (
  req: NextRequest,
  context: ApiContext
) => Promise<NextResponse<T>>

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

export function withApiHandler<T = unknown>(
  handler: ApiHandler<T>,
  options: ApiHandlerOptions = {}
): (req: NextRequest) => Promise<NextResponse<T>> {
  return async (req: NextRequest): Promise<NextResponse<T>> => {
    const startTime = Date.now()
    const requestId = generateRequestId()
    const apiLogger = options.loggerName
      ? logger.getChildLogger(options.loggerName)
      : logger

    const context: ApiContext = {
      requestId,
    }

    try {
      apiLogger.info(`${req.method} ${req.url}`, {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers.get('user-agent'),
        ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      })

      if (options.requireAuth || options.permission) {
        const session = await getAccessSession()

        if (!session?.user) {
          apiLogger.warn('Unauthorized request', {
            requestId,
            method: req.method,
            url: req.url,
          })

          return NextResponse.json(
            { error: 'Unauthorized' },
            {
              status: 401,
              headers: { 'X-Request-Id': requestId },
            }
          ) as NextResponse<T>
        }

        context.user = session.user as ApiContext['user']
        context.session = session as ApiContext['session']
        context.userId = context.user?.id

        if (
          options.permission &&
          !hasPermission(context.user, options.permission)
        ) {
          apiLogger.warn('Forbidden: Required permission missing', {
            requestId,
            userId: context.userId,
            method: req.method,
            url: req.url,
          })

          return NextResponse.json(
            { error: 'Forbidden' },
            {
              status: 403,
              headers: { 'X-Request-Id': requestId },
            }
          ) as NextResponse<T>
        }
      }

      const response = await handler(req, context)
      const duration = Date.now() - startTime

      apiLogger.info(
        `${req.method} ${req.url} - ${response.status} (${duration}ms)`,
        {
          requestId,
          userId: context.userId,
          statusCode: response.status,
          duration,
        }
      )

      response.headers.set('X-Request-Id', requestId)
      return response
    } catch (error) {
      const duration = Date.now() - startTime

      apiLogger.error('Request handler error', error as Error, {
        requestId,
        userId: context.userId,
        method: req.method,
        url: req.url,
        duration,
      })

      const statusCode = (error as { statusCode?: number })?.statusCode || 500
      const message =
        error instanceof Error ? error.message : 'Internal server error'

      return NextResponse.json(
        {
          error: message,
          requestId,
        },
        {
          status: statusCode,
          headers: { 'X-Request-Id': requestId },
        }
      ) as NextResponse<T>
    }
  }
}
