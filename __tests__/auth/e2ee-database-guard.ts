/** This suite deletes all users; never infer disposability from a name prefix. */
export function e2eeTestDatabaseUrl(value: string): URL {
  const url = new URL(value)
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !['/flare_e2ee_test_local', '/flare_e2ee_test_ci'].includes(url.pathname) ||
    [...url.searchParams.keys()].length > 0
  ) {
    throw new Error(
      'Use the disposable local flare_e2ee_test_local or flare_e2ee_test_ci database'
    )
  }
  return url
}
