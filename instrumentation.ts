export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const replay = process.env.METICULOUS_BACKEND_RECORDER_MODE === 'replay'
    const recording =
      (process.env.NODE_ENV === 'development' ||
        process.env.VERCEL_ENV === 'preview' ||
        process.env.METICULOUS_RECORDING_ENABLED === 'true') &&
      Boolean(process.env.NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN)

    // Initialize before importing application modules, including Prisma.
    if (recording || replay) {
      const { initBackendRecorder } = await import(
        '@alwaysmeticulous/backend-recorder-launcher'
      )
      await initBackendRecorder({
        enabled: true,
        exportMode: 's3',
        meticulousProjectName: 'fl1nt.dev/Flare',
        recordingToken: process.env.NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN,
      })
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
