import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { getConfig } from '@/lib/config'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type LogCategory =
  | 'api'
  | 'auth'
  | 'upload'
  | 'database'
  | 'system'
  | 'user'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  category: LogCategory
  message: string
  metadata?: Record<string, unknown>
  userId?: string
  sessionId?: string
  ipAddress?: string
  userAgent?: string
  requestId?: string
  endpoint?: string
  method?: string
  statusCode?: number
  responseTime?: number
  error?: {
    name: string
    message: string
    stack?: string
  }
}

export interface LoggingConfig {
  enabled: boolean
  level: LogLevel
  console: {
    enabled: boolean
    format: 'json' | 'pretty'
  }
  file: {
    enabled: boolean
    path: string
    maxSize: number // in MB
    maxFiles: number
    format: 'json' | 'pretty'
  }
  categories: {
    [K in LogCategory]: {
      enabled: boolean
      level: LogLevel
    }
  }
}

const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  enabled: true,
  level: 'info',
  console: {
    enabled: true,
    format: 'pretty',
  },
  file: {
    enabled: true,
    path: './logs',
    maxSize: 10, // 10MB
    maxFiles: 5,
    format: 'json',
  },
  categories: {
    api: { enabled: true, level: 'info' },
    auth: { enabled: true, level: 'info' },
    upload: { enabled: true, level: 'info' },
    database: { enabled: true, level: 'warn' },
    system: { enabled: true, level: 'info' },
    user: { enabled: true, level: 'info' },
  },
}

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

class Logger {
  private config: LoggingConfig = DEFAULT_LOGGING_CONFIG
  private initialized = false

  constructor() {
    this.initializeAsync()
  }

  private async initializeAsync() {
    try {
      const appConfig = await getConfig()
      if (appConfig.settings.logging) {
        this.config = {
          ...DEFAULT_LOGGING_CONFIG,
          ...appConfig.settings.logging,
        }
      }
      this.initialized = true
      this.ensureLogDirectory()
    } catch {
      // Fallback to default config if can't load from database
      this.initialized = true
      this.ensureLogDirectory()
    }
  }

  private ensureLogDirectory() {
    if (this.config.file.enabled && !existsSync(this.config.file.path)) {
      mkdirSync(this.config.file.path, { recursive: true })
    }
  }

  private shouldLog(level: LogLevel, category: LogCategory): boolean {
    if (!this.config.enabled) return false
    if (!this.config.categories[category].enabled) return false

    const globalLevel = LOG_LEVELS[this.config.level]
    const categoryLevel = LOG_LEVELS[this.config.categories[category].level]
    const entryLevel = LOG_LEVELS[level]

    return entryLevel <= Math.min(globalLevel, categoryLevel)
  }

  private formatLogEntry(entry: LogEntry, format: 'json' | 'pretty'): string {
    if (format === 'json') {
      return JSON.stringify(entry)
    }

    // Pretty format
    const timestamp = new Date(entry.timestamp).toISOString()
    const level = entry.level.toUpperCase().padEnd(5)
    const category = entry.category.toUpperCase().padEnd(8)

    let formatted = `[${timestamp}] ${level} ${category} ${entry.message}`

    if (entry.endpoint) {
      formatted += ` | ${entry.method} ${entry.endpoint}`
    }

    if (entry.statusCode) {
      formatted += ` | ${entry.statusCode}`
    }

    if (entry.responseTime) {
      formatted += ` | ${entry.responseTime}ms`
    }

    if (entry.userId) {
      formatted += ` | User: ${entry.userId}`
    }

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      formatted += ` | ${JSON.stringify(entry.metadata)}`
    }

    if (entry.error) {
      formatted += `\nError: ${entry.error.name}: ${entry.error.message}`
      if (entry.error.stack) {
        formatted += `\nStack: ${entry.error.stack}`
      }
    }

    return formatted
  }

  private writeToFile(entry: LogEntry) {
    if (!this.config.file.enabled) return

    try {
      const logFile = join(
        this.config.file.path,
        `flare-${new Date().toISOString().split('T')[0]}.log`
      )
      const formattedEntry = this.formatLogEntry(entry, this.config.file.format)

      appendFileSync(logFile, formattedEntry + '\n', 'utf8')
    } catch (error) {
      console.error('Failed to write log to file:', error)
    }
  }

  private writeToConsole(entry: LogEntry) {
    if (!this.config.console.enabled) return

    const formatted = this.formatLogEntry(entry, this.config.console.format)

    switch (entry.level) {
      case 'error':
        console.error(formatted)
        break
      case 'warn':
        console.warn(formatted)
        break
      case 'info':
        console.info(formatted)
        break
      case 'debug':
        console.debug(formatted)
        break
    }
  }

  public log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    metadata?: Partial<LogEntry>
  ) {
    if (!this.shouldLog(level, category)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      ...metadata,
    }

    this.writeToConsole(entry)
    this.writeToFile(entry)
  }

  public error(
    category: LogCategory,
    message: string,
    metadata?: Partial<LogEntry>
  ) {
    this.log('error', category, message, metadata)
  }

  public warn(
    category: LogCategory,
    message: string,
    metadata?: Partial<LogEntry>
  ) {
    this.log('warn', category, message, metadata)
  }

  public info(
    category: LogCategory,
    message: string,
    metadata?: Partial<LogEntry>
  ) {
    this.log('info', category, message, metadata)
  }

  public debug(
    category: LogCategory,
    message: string,
    metadata?: Partial<LogEntry>
  ) {
    this.log('debug', category, message, metadata)
  }

  // Convenience methods for specific use cases
  public apiRequest(
    method: string,
    endpoint: string,
    metadata?: Partial<LogEntry>
  ) {
    this.info('api', `${method} ${endpoint}`, {
      method,
      endpoint,
      ...metadata,
    })
  }

  public apiResponse(
    method: string,
    endpoint: string,
    statusCode: number,
    responseTime: number,
    metadata?: Partial<LogEntry>
  ) {
    const level =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
    this.log(level, 'api', `${method} ${endpoint} - ${statusCode}`, {
      method,
      endpoint,
      statusCode,
      responseTime,
      ...metadata,
    })
  }

  public userAction(
    action: string,
    userId: string,
    metadata?: Partial<LogEntry>
  ) {
    this.info('user', `User action: ${action}`, {
      userId,
      ...metadata,
    })
  }

  public authEvent(event: string, metadata?: Partial<LogEntry>) {
    this.info('auth', `Auth event: ${event}`, metadata)
  }

  public uploadEvent(
    event: string,
    userId: string,
    metadata?: Partial<LogEntry>
  ) {
    this.info('upload', `Upload event: ${event}`, {
      userId,
      ...metadata,
    })
  }

  public systemEvent(event: string, metadata?: Partial<LogEntry>) {
    this.info('system', `System event: ${event}`, metadata)
  }

  public databaseError(
    operation: string,
    error: Error,
    metadata?: Partial<LogEntry>
  ) {
    this.error('database', `Database error in ${operation}`, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...metadata,
    })
  }
}

// Create singleton instance
export const logger = new Logger()

// Export helper functions for common logging patterns
export function createRequestLogger(req: Request) {
  const url = new URL(req.url)
  const method = req.method
  const endpoint = url.pathname
  const startTime = Date.now()
  const requestId = Math.random().toString(36).substring(7)

  const userAgent = req.headers.get('user-agent') || 'Unknown'
  const ipAddress = req.headers.get('x-forwarded-for') || 'Unknown'

  // Log incoming request
  logger.apiRequest(method, endpoint, {
    requestId,
    ipAddress,
    userAgent,
  })

  return {
    requestId,
    complete: (
      statusCode: number,
      userId?: string,
      metadata?: Record<string, unknown>
    ) => {
      const responseTime = Date.now() - startTime
      logger.apiResponse(method, endpoint, statusCode, responseTime, {
        requestId,
        userId,
        ipAddress,
        userAgent,
        ...metadata,
      })
    },
  }
}

export function logError(
  category: LogCategory,
  message: string,
  error: Error,
  metadata?: Partial<LogEntry>
) {
  logger.error(category, message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...metadata,
  })
}
