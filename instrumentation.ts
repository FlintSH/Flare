export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runStartupTasks } = await import('./lib/startup/index')
    await runStartupTasks()
    console.log('Startup tasks completed via instrumentation hook')
  }
}
