import { describe, expect, it } from 'vitest'

import { getDocumentationUrl } from '@/lib/documentation'

describe('documentation links', () => {
  it.each(['2.1.0', 'v2.1.0', '2.1.0+build.42', 'v2.1.0+build.42'])(
    'opens the installed stable release archive for %s',
    (version) => {
      const build = { version, channel: 'stable' as const }

      expect(getDocumentationUrl(build)).toBe(
        'https://flintsh.github.io/Flare/versions/v2.1.0/'
      )
      expect(getDocumentationUrl(build, 'setup')).toBe(
        'https://flintsh.github.io/Flare/versions/v2.1.0/admin/setup.html'
      )
    }
  )

  it('selects a different installed release instead of the current package or latest docs', () => {
    const build = { version: '3.12.7', channel: 'stable' as const }

    expect(getDocumentationUrl(build)).toBe(
      'https://flintsh.github.io/Flare/versions/v3.12.7/'
    )
    expect(getDocumentationUrl(build, 'setup')).toBe(
      'https://flintsh.github.io/Flare/versions/v3.12.7/admin/setup.html'
    )
  })

  it.each(['2.1.0', '2.2.0-rolling.1', 'unknown'])(
    'uses the explicit rolling channel for package version %s',
    (version) => {
      const build = { version, channel: 'rolling' as const }

      expect(getDocumentationUrl(build)).toBe(
        'https://flintsh.github.io/Flare/rolling/'
      )
      expect(getDocumentationUrl(build, 'setup')).toBe(
        'https://flintsh.github.io/Flare/rolling/admin/setup.html'
      )
    }
  )

  it.each([
    'unknown',
    '',
    '2.1',
    '2.1.0-beta.1',
    '2.1.0-rolling.1',
    '02.1.0',
    '2.1.0+',
    '2.1.0+build..42',
    '2.1.0\n',
    '2.1.0/../../rolling',
    '2.1.0%2f..%2frolling',
    '2.1.0?redirect=https://example.com',
    'https://example.com',
  ])('offers version selection for an unrecognized release: %j', (version) => {
    const build = { version, channel: 'stable' as const }

    expect(getDocumentationUrl(build)).toBe(
      'https://flintsh.github.io/Flare/versions.html'
    )
    expect(getDocumentationUrl(build, 'setup')).toBe(
      'https://flintsh.github.io/Flare/versions.html'
    )
  })
})
