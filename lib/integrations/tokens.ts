import { createHash, randomBytes } from 'node:crypto'

export const API_SCOPES = [
  'files:read',
  'files:upload',
  'urls:read',
  'urls:write',
] as const
export type ApiScope = (typeof API_SCOPES)[number]
export const TOKEN_PREFIX = 'flr_'

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createApiToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: hashApiToken(token) }
}

/** Explicit routes prevent new account/admin endpoints inheriting bearer access. */
export function requiredApiScope(
  method: string,
  pathname: string
): ApiScope | null {
  if (method === 'GET' && ['/api/files', '/api/files/types'].includes(pathname))
    return 'files:read'
  if (method === 'POST' && pathname === '/api/files') return 'files:upload'
  if (
    ['POST', 'GET', 'PUT'].includes(method) &&
    pathname === '/api/files/chunks'
  )
    return 'files:upload'
  if (
    ['GET', 'PUT'].includes(method) &&
    /^\/api\/files\/chunks\/[a-zA-Z0-9_-]+\/part\/\d+$/.test(pathname)
  )
    return 'files:upload'
  if (
    method === 'POST' &&
    /^\/api\/files\/chunks\/[a-zA-Z0-9_-]+\/complete$/.test(pathname)
  )
    return 'files:upload'
  if (method === 'GET' && pathname === '/api/urls') return 'urls:read'
  if (method === 'POST' && pathname === '/api/urls') return 'urls:write'
  if (method === 'DELETE' && /^\/api\/urls\/[a-zA-Z0-9_-]+$/.test(pathname))
    return 'urls:write'
  return null
}

export function tokenAllowsRequest(
  scopes: readonly string[],
  request: Pick<Request, 'method' | 'url'>
): boolean {
  const required = requiredApiScope(
    request.method,
    new URL(request.url).pathname
  )
  return required !== null && scopes.includes(required)
}
