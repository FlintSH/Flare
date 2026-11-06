export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const replay = process.env.METICULOUS_BACKEND_RECORDER_MODE === 'replay'
    const recording =
      (process.env.NODE_ENV === 'development' ||
        process.env.VERCEL_ENV === 'preview' ||
        process.env.METICULOUS_RECORDING_ENABLED === 'true') &&
      Boolean(process.env.NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN)

    // Initialize before importing application modules: the recorder has to
    // wrap the database client before anything builds it.
    if (recording || replay) {
      const { initBackendRecorder } =
        await import('@alwaysmeticulous/backend-recorder-launcher')
      const recorder = await initBackendRecorder({
        enabled: true,
        exportMode: 's3',
        meticulousProjectName: 'fl1nt.dev/Flare',
        recordingToken: process.env.NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN,
      })
      const extension = recorder?.meticulousPrismaExtension
      if (extension) {
        const { recordDatabaseQueries } =
          await import('./lib/database/query-recorder')
        recordDatabaseQueries(extension)
      }
      // Flush outstanding backend spans during normal Next.js shutdown.
      const flush = () => {
        void recorder?.stopRecording().catch((error: unknown) => {
          console.error('Could not flush Meticulous backend recording', error)
        })
      }
      process.once('SIGTERM', flush)
      process.once('SIGINT', flush)
    }

    const { runStartupTasks } = await import('./lib/startup/index')
    const { loggers } = await import('./lib/logger')
    const logger = loggers.startup

    await runStartupTasks()
    logger.debug('Startup tasks completed via instrumentation hook')
  }
}
