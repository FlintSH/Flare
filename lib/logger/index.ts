import { NextRequest } from 'next/server'

import pino, { Logger as PinoLogger } from 'pino'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

interface LoggerOptions {
  name?: string
  level?: LogLevel
}

interface RequestLogContext {
  method: string
  url: string
  userAgent?: string
  ip?: string
  userId?: string
  sessionId?: string
}

interface ErrorLogContext {
  error: Error | unknown
  context?: Record<string, unknown>
}

const isDevelopment = process.env.NODE_ENV === 'development'
const isProduction = process.env.NODE_ENV === 'production'

const defaultLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || (isDevelopment ? 'debug' : 'info')

const formatters = {
  level: (label: string) => {
    return { level: label.toUpperCase() }
  },
  bindings: (bindings: pino.Bindings) => {
    return {
      pid: bindings.pid,
      host: bindings.hostname,
      node: process.version,
    }
  },
}

// Fallback to console transport due to worker thread issues
const transport = isDevelopment
  ? {
      write: (msg: string) => {
        try {
          const obj = JSON.parse(msg)
          const timestamp = new Date(obj.time)
            .toISOString()
            .replace('T', ' ')
            .slice(0, -5)
          const level = (
            obj.level === 30
              ? 'INFO'
              : obj.level === 40
                ? 'WARN'
                : obj.level === 50
                  ? 'ERROR'
                  : obj.level === 20
                    ? 'DEBUG'
                    : 'TRACE'
          ).padEnd(5)
          const name = obj.name ? `[${obj.name}]`.padEnd(12) : ''
          const message = obj.msg || ''
          console.log(`${timestamp} ${level} ${name} ${message}`)
        } catch {
          console.log(msg)
        }
      },
    }
  : undefined

const baseLogger = pino(
  {
    level: defaultLevel,
    formatters,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      error: pino.stdSerializers.err,
      err: pino.stdSerializers.err,
      req: (req: {
        method?: string
        url?: string
        headers?: Record<string, string>
      }) => ({
        method: req.method,
        url: req.url,
        headers: {
          'user-agent': req.headers?.['user-agent'],
          'content-type': req.headers?.['content-type'],
        },
      }),
      res: (res: { statusCode?: number }) => ({
        statusCode: res.statusCode,
      }),
    },
    redact: {
      paths: [
        'password',
        'token',
        'authorization',
        'cookie',
        'sessionId',
        'apiKey',
        'secret',
        '*.password',
        '*.token',
        '*.authorization',
        '*.sessionId',
        '*.apiKey',
        '*.secret',
        'headers.authorization',
        'headers.cookie',
        'headers["x-auth-token"]',
      ],
      censor: '[REDACTED]',
    },
    ...(isProduction && {
      browser: {
        write: () => {},
      },
    }),
  },
  transport
)

export class Logger {
  private logger: PinoLogger

  constructor(options: LoggerOptions = {}) {
    this.logger = baseLogger.child({
      name: options.name || 'app',
      ...(options.level && { level: options.level }),
    })
  }

  private formatMessage(
    message: string,
    context?: Record<string, unknown>
  ): string | Record<string, unknown> {
    if (context && Object.keys(context).length > 0) {
      return { msg: message, ...context }
    }
    return message
  }

  fatal(message: string, context?: Record<string, unknown>) {
    this.logger.fatal(this.formatMessage(message, context))
  }

  error(
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>
  ) {
    if (error instanceof Error) {
      this.logger.error({ error, ...context }, message)
    } else if (error) {
      this.logger.error(
        { error: { message: String(error) }, ...context },
        message
      )
    } else {
      this.logger.error(this.formatMessage(message, context))
    }
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.logger.warn(this.formatMessage(message, context))
  }

  info(message: string, context?: Record<string, unknown>) {
    this.logger.info(this.formatMessage(message, context))
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.logger.debug(this.formatMessage(message, context))
  }

  trace(message: string, context?: Record<string, unknown>) {
    this.logger.trace(this.formatMessage(message, context))
  }

  logRequest(req: NextRequest, context?: Partial<RequestLogContext>) {
    const requestContext: RequestLogContext = {
      method: req.method,
      url: req.url,
      userAgent: req.headers.get('user-agent') || undefined,
      ip:
        req.headers.get('x-forwarded-for') ||
        req.headers.get('x-real-ip') ||
        undefined,
      ...context,
    }

    this.info(`${requestContext.method} ${requestContext.url}`, {
      request: requestContext,
    })
  }

  logResponse(
    req: NextRequest,
    statusCode: number,
    duration: number,
    context?: Record<string, unknown>
  ) {
    const level =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'

    const message = `${req.method} ${req.url} - ${statusCode} (${duration}ms)`

    this[level](message, {
      response: {
        statusCode,
        duration,
        method: req.method,
        url: req.url,
      },
      ...context,
    })
  }

  logError(errorContext: ErrorLogContext) {
    const { error, context } = errorContext

    if (error instanceof Error) {
      this.error(error.message, error, context)
    } else {
      this.error('An unknown error occurred', error, context)
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      name: bindings.name || this.logger.bindings().name,
    })
  }

  getChildLogger(name: string): Logger {
    return new Logger({ name })
  }
}

const createLogger = (name: string): Logger => {
  return new Logger({ name })
}

const defaultLogger = new Logger({ name: 'flare' })

export { createLogger, defaultLogger as logger }

export const loggers = {
  api: createLogger('api'),
  auth: createLogger('auth'),
  db: createLogger('db'),
  storage: createLogger('storage'),
  events: createLogger('events'),
  ocr: createLogger('ocr'),
  files: createLogger('files'),
  users: createLogger('users'),
  config: createLogger('config'),
  startup: createLogger('startup'),
  middleware: createLogger('middleware'),
}
