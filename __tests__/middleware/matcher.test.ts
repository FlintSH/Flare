import { config } from '@/middleware'
import { describe, expect, it } from 'vitest'

// Next.js compiles each matcher source into an anchored regular expression.
const matchers = config.matcher.map((source) => new RegExp(`^${source}$`))
const runsFor = (path: string) => matchers.some((matcher) => matcher.test(path))

describe('middleware matcher', () => {
  it('never runs for API routes, so Next.js passes request bodies through whole', () => {
    for (const path of [
      '/api/files',
      '/api/files/chunks',
      '/api/files/chunks/abc123/part/1',
      '/api/settings',
      '/api/auth/session',
    ])
      expect(runsFor(path)).toBe(false)
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
      expect(runsFor(path)).toBe(true)
  })
})
