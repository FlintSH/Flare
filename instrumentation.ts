export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupTasks } = await import('./lib/startup/index')
    const { loggers } = await import('./lib/logger')
    const logger = loggers.startup

    await runStartupTasks()
    logger.debug('Startup tasks completed via instrumentation hook')
  }
}
