import { sanitizeUrl } from '@/lib/utils/url'

describe('sanitizeUrl', () => {
  it('should return root path for non-relative URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('/')
    expect(sanitizeUrl('http://example.com')).toBe('/')
    expect(sanitizeUrl('example.com')).toBe('/')
  })

  it('should preserve valid relative paths', () => {
    expect(sanitizeUrl('/path')).toBe('/path')
    expect(sanitizeUrl('/path/to/resource')).toBe('/path/to/resource')
    expect(sanitizeUrl('/path?query=value')).toBe('/path?query=value')
  })

  it('should handle query parameters correctly', () => {
    expect(sanitizeUrl('/path?a=1&b=2')).toBe('/path?a=1&b=2')
    expect(sanitizeUrl('/path?')).toBe('/path?')
    expect(sanitizeUrl('/path?test')).toBe('/path?test')
  })

  it('should sanitize potentially malicious URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('/')
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('/')
    expect(sanitizeUrl('/path/javascript:alert(1)')).toBe('/')
  })

  it('should handle edge cases', () => {
    expect(sanitizeUrl('')).toBe('/')
    expect(sanitizeUrl('/')).toBe('/')
    expect(sanitizeUrl('///')).toBe('/')
    expect(sanitizeUrl('/path/../..')).toBe('/')
  })

  it('should handle invalid URLs', () => {
    expect(sanitizeUrl('not a url')).toBe('/')
    expect(sanitizeUrl('http://')).toBe('/')
    expect(sanitizeUrl('https://')).toBe('/')
  })
})
