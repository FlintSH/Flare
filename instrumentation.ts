export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Register segfault handler early to catch crashes
    try {
      const { default: segfaultHandler } = await import('node-segfault-handler')
      // Write segfault info to a log file for easier debugging
      const logPath = process.env.SEGFAULT_LOG_PATH || './segfault.log'
      segfaultHandler.registerHandler(logPath)
      console.log(`Segfault handler registered, will write to: ${logPath}`)
    } catch (error) {
      console.warn('Failed to register segfault handler:', error)
    }

    const { runStartupTasks } = await import('./lib/startup/index')
    const { loggers } = await import('./lib/logger')
    const logger = loggers.startup

    await runStartupTasks()
    logger.debug('Startup tasks completed via instrumentation hook')

    // Monitor memory usage in production
    if (process.env.NODE_ENV === 'production') {
      setInterval(() => {
        const memUsage = process.memoryUsage()
        if (memUsage.heapUsed > 1024 * 1024 * 1024) {
          // 1GB threshold
          logger.warn('High memory usage detected', {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
            external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
          })
        }
      }, 60000) // Check every minute
    }
  }
}
