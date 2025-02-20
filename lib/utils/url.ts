export function sanitizeUrl(url: string): string {
  try {
    // Ensure the URL is relative and doesn't contain any javascript: or data: protocols
    if (!url.startsWith('/')) return '/'
    const urlObj = new URL(url, window.location.origin)
    // Only allow specific protocols and ensure it's from our domain
    if (!['http:', 'https:'].includes(urlObj.protocol)) return '/'
    // Return just the pathname and search params to ensure it's relative
    return `${urlObj.pathname}${urlObj.search}`
  } catch {
    // If URL parsing fails, return root
    return '/'
  }
}
