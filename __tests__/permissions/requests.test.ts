import { describe, expect, it } from 'vitest'

import {
  requestPermissions,
  requiredApiScope,
} from '@/lib/integrations/bearer-routes'
import { ALL_PERMISSIONS } from '@/lib/permissions/catalog'
import {
  settingsFieldPermission,
  settingsPatchAllowed,
} from '@/lib/permissions/settings'

describe('bearer route permissions', () => {
  it.each([
    ['GET', '/api/settings', []],
    ['GET', '/api/files', ['files.read']],
    ['GET', '/api/files/timeline', ['files.read']],
    ['GET', '/api/files/tags', ['files.read']],
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
    ['PATCH', '/api/urls/short', ['links.create', 'links.delete']],
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
  it.each([
    ['GET', '/api/files', 'files:read', ['files.read']],
    ['PUT', '/api/files/chunks/abc/part/1', 'files:upload', ['files.upload']],
    ['POST', '/api/urls', 'urls:write', ['links.create']],
    ['DELETE', '/api/urls/cm_link', 'urls:write', ['links.delete']],
    [
      'PATCH',
      '/api/urls/cm_link',
      'urls:write',
      ['links.create', 'links.delete'],
    ],
  ])(
    '%s %s takes its token scope and role grants from one entry',
    (method, path, scope, permissions) => {
      expect(requiredApiScope(method, path)).toBe(scope)
      expect(requestPermissions(method, path)).toEqual(permissions)
    }
  )
  it('keeps session-only routes off the named-token allowlist', () => {
    expect(requestPermissions('GET', '/api/files/tags')).toEqual(['files.read'])
    expect(requiredApiScope('GET', '/api/files/tags')).toBeNull()
  })
  it.each([
    ['GET', '/api/files/chunks/a.b/part/1'],
    ['PUT', '/api/files/chunks/a%2Fb/part/1'],
    ['POST', '/api/files/chunks/a%2fb/complete'],
    ['DELETE', '/api/urls/a.b'],
    ['PATCH', '/api/urls/a.b'],
  ])(
    'refuses %s %s for every credential: named-token routes accept only plain IDs',
    (method, path) => {
      expect(requestPermissions(method, path)).toBeNull()
      expect(requiredApiScope(method, path)).toBeNull()
    }
  )
  it.each([
    ['PATCH', '/api/folders/a.b', ['folders.manage']],
    ['DELETE', '/api/tags/a.b', ['tags.manage']],
    ['POST', '/api/tags/a.b/apply', ['tags.manage', 'files.update']],
    ['GET', '/api/files/a.b/expiry', ['files.read']],
  ])(
    'leaves any ID segment of the session-only %s %s to its handler',
    (method, path, permissions) => {
      expect(requestPermissions(method, path)).toEqual(permissions)
    }
  )
})

describe('delegated settings', () => {
  const general = { permissions: ['settings.general'] }
  it('does not let a general-settings editor change storage, SSO, registration, the MCP server, email, appearance or setup', () => {
    for (const settings of [
      { general: { storage: { provider: 's3' } } },
      { general: { oidc: { enabled: true } } },
      { general: { registrations: { enabled: true } } },
      { general: { mcp: { enabled: true } } },
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
  it('lets Security settings, and nothing less, turn the MCP server on or off', () => {
    const security = { permissions: ['settings.security'] }
    for (const enabled of [true, false]) {
      const settings = { general: { mcp: { enabled } } }
      expect(settingsPatchAllowed(security, settings)).toBe(true)
      expect(
        settingsPatchAllowed({ permissions: ['administrator'] }, settings)
      ).toBe(true)
      // Every other settings permission together is not enough.
      expect(
        settingsPatchAllowed(
          {
            permissions: [
              'settings.read',
              'settings.general',
              'settings.storage',
              'settings.email',
              'appearance.manage',
            ],
          },
          settings
        )
      ).toBe(false)
      expect(settingsPatchAllowed({ permissions: [] }, settings)).toBe(false)
    }
    // Beside a field that needs another permission, both are needed.
    const mixed = {
      general: { mcp: { enabled: true }, ocr: { enabled: true } },
    }
    expect(settingsPatchAllowed(security, mixed)).toBe(false)
    expect(settingsPatchAllowed(general, mixed)).toBe(false)
    expect(
      settingsPatchAllowed(
        { permissions: ['settings.security', 'settings.general'] },
        mixed
      )
    ).toBe(true)
  })
  it('lets only an administrator turn administration through MCP on or off', () => {
    const security = { permissions: ['settings.security'] }
    const administrator = { permissions: ['administrator'] }
    // Every permission but administrator, so every key but one.
    const everything = {
      permissions: ALL_PERMISSIONS.filter(
        (permission) => permission !== 'administrator'
      ),
    }
    for (const administration of [true, false]) {
      const settings = { general: { mcp: { administration } } }
      expect(settingsPatchAllowed(administrator, settings)).toBe(true)
      expect(settingsPatchAllowed(security, settings)).toBe(false)
      expect(settingsPatchAllowed(everything, settings)).toBe(false)
      // Beside the server switch, which Security settings may change.
      const both = { general: { mcp: { enabled: true, administration } } }
      expect(settingsPatchAllowed(security, both)).toBe(false)
      expect(settingsPatchAllowed(everything, both)).toBe(false)
      expect(settingsPatchAllowed(administrator, both)).toBe(true)
    }
    // Security settings still turns the server itself on and off.
    expect(
      settingsPatchAllowed(security, { general: { mcp: { enabled: false } } })
    ).toBe(true)
  })
  it('names the permission of each settings field as the patch rule does', () => {
    expect(settingsFieldPermission('general.mcp.enabled')).toBe(
      'settings.security'
    )
    expect(settingsFieldPermission('general.mcp.administration')).toBe(
      'administrator'
    )
    expect(settingsFieldPermission('general.registrations')).toBe(
      'settings.security'
    )
    expect(settingsFieldPermission('general.storage')).toBe('settings.storage')
    expect(settingsFieldPermission('appearance.theme')).toBe(
      'appearance.manage'
    )
    expect(settingsFieldPermission('advanced.customHead')).toBe('administrator')
    for (const path of [
      'general.setup',
      'general.mcp',
      'general.mcp.unknown',
      'general.toString',
      'email.smtp',
      'customization',
      'constructor',
    ])
      expect(settingsFieldPermission(path), path).toBeUndefined()
  })
  it('refuses an MCP change that names no field, a field it does not know, or no object', () => {
    const security = { permissions: ['settings.security'] }
    for (const mcp of [
      {},
      null,
      true,
      'on',
      [{ enabled: true }],
      // Security settings is not enough for this one.
      { administration: true },
      { enabled: true, administration: true },
      { unknown: 1 },
      { toString: 1 },
    ])
      expect(
        settingsPatchAllowed(security, { general: { mcp } }),
        JSON.stringify(mcp)
      ).toBe(false)
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
