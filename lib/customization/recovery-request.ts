export const RECOVERY_HEADER = 'x-flare-appearance-recovery'
export const RECOVERY_PATHS = ['/dashboard/customize', '/dashboard/settings']

export function recoveryRequestHeaders(
  original: Headers,
  pathname: string,
  requested: boolean,
  authenticated: boolean
): Headers {
  const headers = new Headers(original)
  // An incoming header is never evidence of permission. Middleware derives it
  // only for the two recovery screens after checking the signed session.
  headers.delete(RECOVERY_HEADER)
  if (authenticated && requested && RECOVERY_PATHS.includes(pathname))
    headers.set(RECOVERY_HEADER, '1')
  return headers
}
