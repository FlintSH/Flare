// This historical filename remains for compatibility with older PR workflows.
// It validates the disposable runtime only; Flare owns first-run setup and all
// user and configuration creation. No database client or fixture code runs here.
function validateEnvironment(env = process.env) {
  let database
  let origin
  try {
    database = new URL(env.DATABASE_URL)
    origin = new URL(env.NEXTAUTH_URL)
  } catch {
    throw new Error('Preview database and public origin must be configured.')
  }
  if (
    !['postgresql:', 'postgres:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost'].includes(database.hostname) ||
    database.port !== '5432' ||
    !database.username ||
    !database.password ||
    !/^\/[a-zA-Z0-9_]+$/.test(database.pathname) ||
    database.hash ||
    [...database.searchParams].some(
      ([key, value]) => key !== 'schema' || value !== 'public'
    )
  )
    throw new Error('Preview startup requires the isolated local database.')
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Preview NEXTAUTH_URL must be an HTTPS origin.')
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32)
    throw new Error(
      'Preview requires a fresh session secret of at least 32 characters.'
    )
}

if (require.main === module) {
  try {
    validateEnvironment()
  } catch (error) {
    // Do not include database URLs or credentials in public workflow logs.
    console.error('Preview initialization failed:', error.message)
    process.exitCode = 1
  }
}

module.exports = { validateEnvironment }
