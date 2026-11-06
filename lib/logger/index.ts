import pino, { Logger as PinoLogger } from 'pino'

import { sanitizeLogUrl } from './url'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

interface LoggerOptions {
  name?: string
  level?: LogLevel
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
        url: req.url ? sanitizeLogUrl(req.url) : undefined,
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

  getChildLogger(name: string): Logger {
    return new Logger({ name })
  }
}

const createLogger = (name: string): Logger => {
  return new Logger({ name })
}

export { createLogger }

export const loggers = {
  api: createLogger('api'),
  db: createLogger('db'),
  storage: createLogger('storage'),
  ocr: createLogger('ocr'),
  files: createLogger('files'),
  users: createLogger('users'),
  config: createLogger('config'),
  startup: createLogger('startup'),
  middleware: createLogger('middleware'),
}
