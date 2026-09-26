import type { Permission } from './catalog'

/** Bearer-capable endpoints opt in explicitly; unknown paths and methods fail closed. */
export function requestPermissions(
  method: string,
  pathname: string
): Permission[] | null {
  if (pathname === '/api/settings' && method === 'GET') return [] // public projection; privileged projection is session-only
  if (pathname === '/api/files')
    return method === 'GET'
      ? ['files.read']
      : method === 'POST'
        ? ['files.upload']
        : null
  if (
    (pathname === '/api/files/chunks' &&
      ['GET', 'POST', 'PUT'].includes(method)) ||
    (/^\/api\/files\/chunks\/[^/]+\/part\/\d+$/.test(pathname) &&
      ['GET', 'PUT'].includes(method)) ||
    (/^\/api\/files\/chunks\/[^/]+\/complete$/.test(pathname) &&
      method === 'POST')
  )
    return ['files.upload']
  if (pathname === '/api/files/types' && method === 'GET') return ['files.read']
  if (pathname === '/api/files/folders' && method === 'POST')
    return ['files.update', 'folders.manage']
  if (pathname === '/api/files/tags' && method === 'PATCH')
    return ['files.update', 'tags.manage']
  if (
    /^\/api\/files\/[^/]+\/expiry$/.test(pathname) &&
    ['GET', 'POST', 'DELETE'].includes(method)
  )
    return [method === 'GET' ? 'files.read' : 'files.update']
  if (pathname === '/api/folders' && ['GET', 'POST'].includes(method))
    return [method === 'GET' ? 'files.read' : 'folders.manage']
  if (
    /^\/api\/folders\/[^/]+$/.test(pathname) &&
    ['PATCH', 'DELETE'].includes(method)
  )
    return ['folders.manage']
  if (pathname === '/api/tags' && ['GET', 'POST'].includes(method))
    return [method === 'GET' ? 'files.read' : 'tags.manage']
  if (
    /^\/api\/tags\/[^/]+$/.test(pathname) &&
    ['PATCH', 'DELETE'].includes(method)
  )
    return ['tags.manage']
  if (/^\/api\/tags\/[^/]+\/apply$/.test(pathname) && method === 'POST')
    return ['tags.manage', 'files.update']
  if (pathname === '/api/urls' && ['GET', 'POST'].includes(method))
    return [method === 'GET' ? 'links.read' : 'links.create']
  if (/^\/api\/urls\/[^/]+$/.test(pathname) && method === 'DELETE')
    return ['links.delete']
  if (pathname === '/api/profile' && ['PUT', 'DELETE'].includes(method))
    return ['profile.update']
  if (pathname === '/api/profile/export' && method === 'GET')
    return ['profile.export', 'files.read', 'links.read']
  if (
    pathname === '/api/profile/upload-token' &&
    ['GET', 'POST'].includes(method)
  )
    return ['tokens.manage']
  return null
}
