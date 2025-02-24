export function sanitizeUrl(url: string): string {
  try {
    // Ensure the URL is relative
    if (!url.startsWith('/')) return '/'

    // Check for malicious protocols in the path
    if (
      url.toLowerCase().includes('javascript:') ||
      url.toLowerCase().includes('data:')
    ) {
      return '/'
    }

    // Handle empty query parameters
    if (url.endsWith('?')) {
      return url
    }

    const urlObj = new URL(url, 'http://example.com')

    // Return the pathname and search params
    return `${urlObj.pathname}${urlObj.search}`
  } catch {
    // If URL parsing fails, return root
    return '/'
  }
}
