export function sanitizeUrl(url: string): string {
  try {
    if (!url.startsWith('/')) return '/'
    const urlObj = new URL(url, window.location.origin)
    if (!['http:', 'https:'].includes(urlObj.protocol)) return '/'
    return `${urlObj.pathname}${urlObj.search}`
  } catch {
    return '/'
  }
}
