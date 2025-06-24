import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { LogCategory, LogEntry, LogLevel } from './index'

export interface LogFilter {
  level?: LogLevel
  category?: LogCategory
  userId?: string
  startDate?: Date
  endDate?: Date
  search?: string
  limit?: number
  offset?: number
}

export interface LogViewerResult {
  logs: LogEntry[]
  total: number
  hasMore: boolean
}

export class LogViewer {
  private logDirectory: string

  constructor(logDirectory: string = './logs') {
    this.logDirectory = logDirectory
  }

  /**
   * Get all available log files
   */
  getLogFiles(): string[] {
    try {
      const files = readdirSync(this.logDirectory)
      return files
        .filter((file) => file.endsWith('.log'))
        .sort((a, b) => {
          const statA = statSync(join(this.logDirectory, a))
          const statB = statSync(join(this.logDirectory, b))
          return statB.mtime.getTime() - statA.mtime.getTime()
        })
    } catch (error) {
      console.error('Error reading log directory:', error)
      return []
    }
  }

  /**
   * Read logs from a specific file
   */
  readLogFile(filename: string): LogEntry[] {
    try {
      const filePath = join(this.logDirectory, filename)
      const content = readFileSync(filePath, 'utf8')
      const lines = content.trim().split('\n')

      const logs: LogEntry[] = []
      for (const line of lines) {
        if (line.trim()) {
          try {
            const logEntry = JSON.parse(line) as LogEntry
            logs.push(logEntry)
          } catch (parseError) {
            // Skip invalid JSON lines
            console.warn('Failed to parse log line:', line)
          }
        }
      }

      return logs.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
    } catch (error) {
      console.error(`Error reading log file ${filename}:`, error)
      return []
    }
  }

  /**
   * Filter logs based on criteria
   */
  filterLogs(logs: LogEntry[], filter: LogFilter): LogEntry[] {
    let filtered = logs

    if (filter.level) {
      const levelPriority = { error: 0, warn: 1, info: 2, debug: 3 }
      const targetLevel = levelPriority[filter.level]
      filtered = filtered.filter(
        (log) => levelPriority[log.level] <= targetLevel
      )
    }

    if (filter.category) {
      filtered = filtered.filter((log) => log.category === filter.category)
    }

    if (filter.userId) {
      filtered = filtered.filter((log) => log.userId === filter.userId)
    }

    if (filter.startDate) {
      filtered = filtered.filter(
        (log) => new Date(log.timestamp) >= filter.startDate!
      )
    }

    if (filter.endDate) {
      filtered = filtered.filter(
        (log) => new Date(log.timestamp) <= filter.endDate!
      )
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          (log.endpoint && log.endpoint.toLowerCase().includes(searchLower)) ||
          (log.metadata &&
            JSON.stringify(log.metadata).toLowerCase().includes(searchLower))
      )
    }

    return filtered
  }

  /**
   * Get logs with pagination and filtering
   */
  getLogs(filter: LogFilter = {}): LogViewerResult {
    const logFiles = this.getLogFiles()
    let allLogs: LogEntry[] = []

    // Read logs from all files (most recent first)
    for (const file of logFiles) {
      const fileLogs = this.readLogFile(file)
      allLogs = allLogs.concat(fileLogs)
    }

    // Sort all logs by timestamp (newest first)
    allLogs.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    // Apply filters
    const filteredLogs = this.filterLogs(allLogs, filter)

    // Apply pagination
    const offset = filter.offset || 0
    const limit = filter.limit || 100
    const paginatedLogs = filteredLogs.slice(offset, offset + limit)

    return {
      logs: paginatedLogs,
      total: filteredLogs.length,
      hasMore: offset + limit < filteredLogs.length,
    }
  }

  /**
   * Get log statistics
   */
  getLogStats(filter: LogFilter = {}): {
    totalLogs: number
    errorCount: number
    warnCount: number
    infoCount: number
    debugCount: number
    categoryCounts: Record<LogCategory, number>
    timeRange: { start: Date | null; end: Date | null }
  } {
    const result = this.getLogs({ ...filter, limit: 10000 })
    const logs = result.logs

    const stats = {
      totalLogs: logs.length,
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
      debugCount: 0,
      categoryCounts: {
        api: 0,
        auth: 0,
        upload: 0,
        database: 0,
        system: 0,
        user: 0,
      } as Record<LogCategory, number>,
      timeRange: {
        start: null as Date | null,
        end: null as Date | null,
      },
    }

    if (logs.length === 0) return stats

    // Calculate counts
    for (const log of logs) {
      switch (log.level) {
        case 'error':
          stats.errorCount++
          break
        case 'warn':
          stats.warnCount++
          break
        case 'info':
          stats.infoCount++
          break
        case 'debug':
          stats.debugCount++
          break
      }

      stats.categoryCounts[log.category]++
    }

    // Calculate time range
    const timestamps = logs.map((log) => new Date(log.timestamp))
    stats.timeRange.start = new Date(
      Math.min(...timestamps.map((d) => d.getTime()))
    )
    stats.timeRange.end = new Date(
      Math.max(...timestamps.map((d) => d.getTime()))
    )

    return stats
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 10): LogEntry[] {
    return this.getLogs({
      level: 'error',
      limit,
    }).logs
  }

  /**
   * Get user activity logs
   */
  getUserActivity(userId: string, limit: number = 50): LogEntry[] {
    return this.getLogs({
      userId,
      limit,
    }).logs
  }

  /**
   * Get API endpoint statistics
   */
  getApiStats(hours: number = 24): {
    totalRequests: number
    errorRate: number
    slowestEndpoints: Array<{
      endpoint: string
      avgResponseTime: number
      count: number
    }>
    statusCodes: Record<number, number>
  } {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)
    const apiLogs = this.getLogs({
      category: 'api',
      startDate: since,
      limit: 10000,
    }).logs

    const stats = {
      totalRequests: apiLogs.length,
      errorRate: 0,
      slowestEndpoints: [] as Array<{
        endpoint: string
        avgResponseTime: number
        count: number
      }>,
      statusCodes: {} as Record<number, number>,
    }

    if (apiLogs.length === 0) return stats

    const endpointStats = new Map<
      string,
      { totalTime: number; count: number }
    >()
    let errorCount = 0

    for (const log of apiLogs) {
      // Count status codes
      if (log.statusCode) {
        stats.statusCodes[log.statusCode] =
          (stats.statusCodes[log.statusCode] || 0) + 1

        if (log.statusCode >= 400) {
          errorCount++
        }
      }

      // Collect endpoint response times
      if (log.endpoint && log.responseTime) {
        const key = `${log.method} ${log.endpoint}`
        const current = endpointStats.get(key) || { totalTime: 0, count: 0 }
        current.totalTime += log.responseTime
        current.count++
        endpointStats.set(key, current)
      }
    }

    stats.errorRate = (errorCount / apiLogs.length) * 100

    // Calculate slowest endpoints
    stats.slowestEndpoints = Array.from(endpointStats.entries())
      .map(([endpoint, data]) => ({
        endpoint,
        avgResponseTime: data.totalTime / data.count,
        count: data.count,
      }))
      .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
      .slice(0, 10)

    return stats
  }
}

// Export a default instance
export const logViewer = new LogViewer()
