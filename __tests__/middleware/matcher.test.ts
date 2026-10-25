import * as staticInfo from 'next/dist/build/analysis/get-page-static-info'

import { config } from '@/middleware'
import { describe, expect, it } from 'vitest'

// The compiler Next.js uses when it builds the middleware manifest. It is
// internal, so its types aren't published.
const { getMiddlewareMatchers } = staticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: string[],
    nextConfig: object
  ) => { regexp: string }[]
}

function runsFor(matcher: string[], path: string) {
  return getMiddlewareMatchers(matcher, {}).some(({ regexp }) =>
    new RegExp(regexp).test(path)
  )
}

const apiPaths = [
  '/api/files',
  '/api/files/chunks',
  '/api/files/chunks/abc123/part/1',
  '/api/settings',
  '/api/auth/session',
]

describe('middleware matcher', () => {
  it('never runs for API routes, so Next.js passes request bodies through whole', () => {
    for (const path of apiPaths)
      expect(runsFor(config.matcher, path)).toBe(false)
  })

  it('still runs for pages, share links, raw content, and short links', () => {
    for (const path of [
      '/',
      '/dashboard',
      '/dashboard/settings',
      '/auth/login',
      '/abc12/report.pdf',
      '/abc12/report.pdf/raw',
      '/u/abc123',
      '/apis-are-not-api/file.png',
    ])
      expect(runsFor(config.matcher, path)).toBe(true)
  })

  it('would notice a matcher that brings API routes back', () => {
    for (const matcher of [
      ['/((?!_next/static|_next/image|favicon.ico).*)'],
      [...config.matcher, '/api/:path*'],
    ])
      expect(apiPaths.some((path) => runsFor(matcher, path))).toBe(true)
  })
})
