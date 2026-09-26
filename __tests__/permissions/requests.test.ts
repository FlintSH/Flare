import { describe, expect, it } from 'vitest'

import { requestPermissions } from '@/lib/permissions/requests'
import { settingsPatchAllowed } from '@/lib/permissions/settings'

describe('bearer route permissions', () => {
  it.each([
    ['GET', '/api/files', ['files.read']],
    ['POST', '/api/files', ['files.upload']],
    ['GET', '/api/files/chunks', ['files.upload']],
    ['POST', '/api/files/chunks/a/complete', ['files.upload']],
    ['PATCH', '/api/files/tags', ['files.update', 'tags.manage']],
    ['POST', '/api/files/folders', ['files.update', 'folders.manage']],
    ['GET', '/api/files/a/expiry', ['files.read']],
    ['DELETE', '/api/files/a/expiry', ['files.update']],
    ['GET', '/api/folders', ['files.read']],
    ['POST', '/api/folders', ['folders.manage']],
    ['POST', '/api/tags/tag/apply', ['tags.manage', 'files.update']],
    ['GET', '/api/urls', ['links.read']],
    ['POST', '/api/urls', ['links.create']],
    ['DELETE', '/api/urls/short', ['links.delete']],
    ['GET', '/api/profile/upload-token', ['tokens.manage']],
    [
      'GET',
      '/api/profile/export',
      ['profile.export', 'files.read', 'links.read'],
    ],
  ])('%s %s requires the correct grants', (method, path, expected) => {
    expect(requestPermissions(method as string, path as string)).toEqual(
      expected
    )
  })
  it.each([
    '/api/users',
    '/api/roles',
    '/api/settings/email',
    '/api/new-feature',
    '/api/integrations',
  ])('does not implicitly authorize %s', (path) => {
    expect(requestPermissions('POST', path)).toBeNull()
  })
})

describe('delegated settings', () => {
  const general = { permissions: ['settings.general'] }
  it('does not let a general-settings editor change storage, SSO, registration, email, appearance or setup', () => {
    for (const settings of [
      { general: { storage: { provider: 's3' } } },
      { general: { oidc: { enabled: true } } },
      { general: { registrations: { enabled: true } } },
      { general: { setup: { completed: false } } },
      { email: { enabled: false } },
      { appearance: { theme: 'dark' } },
      { advanced: { customHead: '<script></script>' } },
      { customization: { published: {} } },
    ])
      expect(settingsPatchAllowed(general, settings)).toBe(false)
    expect(
      settingsPatchAllowed(general, {
        general: { ocr: { enabled: false }, credits: { showFooter: true } },
      })
    ).toBe(true)
  })
  it('reserves executable legacy HTML and CSS for administrators, even when appearance management is delegated', () => {
    expect(
      settingsPatchAllowed(
        { permissions: ['appearance.manage'] },
        {
          advanced: { customHead: '<img src=x onerror=fetch(\"/api/roles\")>' },
        }
      )
    ).toBe(false)
    expect(
      settingsPatchAllowed(
        { permissions: ['administrator'] },
        { advanced: { customCSS: 'body { color: red; }' } }
      )
    ).toBe(true)
  })
  it('checks every field in mixed updates and rejects unknown sections', () => {
    expect(
      settingsPatchAllowed(general, {
        general: { ocr: { enabled: false }, storage: { provider: 'local' } },
      })
    ).toBe(false)
    expect(
      settingsPatchAllowed({ permissions: ['administrator'] }, { unknown: {} })
    ).toBe(false)
    expect(settingsPatchAllowed(general, {})).toBe(false)
  })
  it('uses the union of granular grants without requiring full administrator access', () => {
    expect(
      settingsPatchAllowed(
        { permissions: ['settings.security', 'appearance.manage'] },
        {
          general: { registrations: { enabled: false } },
          appearance: { theme: 'light' },
        }
      )
    ).toBe(true)
  })
})
