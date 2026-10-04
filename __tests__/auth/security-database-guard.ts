/** This suite deletes all users; never infer disposability from a name prefix. */
export function securityTestDatabaseUrl(value: string): URL {
  const url = new URL(value)
  const schemas = url.searchParams.getAll('schema')
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !['/flare_security_test_local', '/flare_security_test_ci'].includes(
      url.pathname
    ) ||
    schemas.length > 1 ||
    (schemas.length === 1 && schemas[0] !== 'public') ||
    [...url.searchParams.keys()].some((key) => key !== 'schema')
  ) {
    throw new Error(
      'Use the disposable local flare_security_test_local or flare_security_test_ci database with its public schema'
    )
  }
  return url
}
