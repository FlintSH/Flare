/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser/API checks against a disposable local Flare instance.
// Run with the handbook's Playwright dependencies installed; see admin/roles.
const assert = require('node:assert/strict')
const { chromium } = require('../../docs/site/node_modules/@playwright/test')
const origin = process.env.FLARE_ROLES_TEST_ORIGIN || 'http://127.0.0.1:3060'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
  throw new Error('Use a disposable local instance.')
const password = 'Roles-demo-only-2026!'
const results = []
async function api(context, path, method = 'GET', data, status = 200) {
  const response = await context.request.fetch(origin + path, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: origin },
  })
  const text = await response.text()
  assert.equal(response.status(), status, `${method} ${path}: ${text}`)
  return text ? JSON.parse(text) : null
}
async function login(browser, email) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  await page.goto(origin + '/auth/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/dashboard', { timeout: 60000 })
  return { context, page }
}
async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  })
  let everyone, original
  let admin
  try {
    admin = await login(browser, 'alex@example.test')
    const session = await api(admin.context, '/api/auth/session')
    assert(session.user.permissions.includes('administrator'))
    const catalog = await api(admin.context, '/api/roles')
    everyone = catalog.roles.find((role) => role.systemKey === 'everyone')
    const fullAdmin = catalog.roles.find((role) =>
      role.permissions.includes('administrator')
    )
    original = everyone.permissions
    results.push(
      'First account receives an Administrator role and live permissions'
    )
    const suffix = Date.now().toString(36)
    const creator = await api(
      admin.context,
      '/api/roles',
      'POST',
      {
        name: `Creator ${suffix}`,
        description: 'Upload, organize, and share work.',
        color: '#8b5cf6',
        position: 20,
        permissions: [
          'files.read',
          'files.upload',
          'files.update',
          'files.delete',
          'files.share',
          'pastes.create',
          'folders.manage',
          'folders.share',
          'tags.manage',
          'links.read',
          'links.create',
          'links.delete',
          'tokens.manage',
          'profile.update',
          'profile.export',
          'uploadProfiles.manage',
        ],
      },
      201
    )
    const moderator = await api(
      admin.context,
      '/api/roles',
      'POST',
      {
        name: `Moderator ${suffix}`,
        description: 'Review shared content and help the community.',
        color: '#10b981',
        position: 40,
        permissions: [
          'users.read',
          'content.read',
          'content.update',
          'content.delete',
        ],
      },
      201
    )
    const support = await api(
      admin.context,
      '/api/roles',
      'POST',
      {
        name: `Support ${suffix}`,
        description: 'Manage lower roles and accounts.',
        color: '#0ea5e9',
        position: 60,
        permissions: [
          'users.read',
          'users.create',
          'users.update',
          'users.delete',
          'users.roles',
          'users.sessions',
          'roles.manage',
          'settings.read',
          'settings.general',
          'files.read',
        ],
      },
      201
    )
    const member = (
      await api(admin.context, '/api/users', 'POST', {
        name: 'Jamie Rivera',
        email: `jamie-${suffix}@example.test`,
        password,
        roleIds: [creator.id],
      })
    ).data
    const helper = (
      await api(admin.context, '/api/users', 'POST', {
        name: 'Sam Taylor',
        email: `sam-${suffix}@example.test`,
        password,
        roleIds: [support.id],
      })
    ).data
    await api(admin.context, `/api/roles/${everyone.id}`, 'PATCH', {
      permissions: [],
    })
    const user = await login(browser, member.email)
    const operator = await login(browser, helper.email)
    await api(
      user.context,
      '/api/roles',
      'POST',
      { name: 'Forbidden', position: 1, permissions: [] },
      403
    )
    await api(
      operator.context,
      '/api/roles',
      'POST',
      { name: 'Escalation', position: 1, permissions: ['administrator'] },
      403
    )
    await api(
      operator.context,
      '/api/roles',
      'POST',
      { name: 'Peer', position: 60, permissions: [] },
      403
    )
    await api(
      operator.context,
      '/api/users',
      'PUT',
      { id: member.id, roleIds: [fullAdmin.id] },
      403
    )
    await api(
      operator.context,
      '/api/users',
      'PUT',
      { id: session.user.id, name: 'Hijacked' },
      403
    )
    await api(
      operator.context,
      '/api/users',
      'PUT',
      { id: helper.id, roleIds: [] },
      403
    )
    results.push(
      'Role hierarchy blocks self, peer, higher-account and administrator escalation'
    )
    await api(
      admin.context,
      '/api/users',
      'PUT',
      { id: session.user.id, roleIds: [] },
      409
    )
    await api(
      admin.context,
      `/api/roles/${fullAdmin.id}`,
      'PATCH',
      { permissions: [] },
      409
    )
    await api(
      admin.context,
      `/api/roles/${fullAdmin.id}`,
      'DELETE',
      undefined,
      409
    )
    await api(
      admin.context,
      `/api/users/${session.user.id}`,
      'DELETE',
      undefined,
      409
    )
    results.push(
      'Last administrator survives account deletion, demotion, role deletion and permission edits'
    )
    await api(operator.context, '/api/settings', 'PATCH', {
      settings: { general: { ocr: { enabled: false } } },
    })
    await api(
      operator.context,
      '/api/settings',
      'PATCH',
      { settings: { general: { registrations: { enabled: false } } } },
      403
    )
    await api(
      operator.context,
      '/api/settings',
      'PATCH',
      { settings: { general: { storage: { provider: 's3' } } } },
      403
    )
    await api(operator.context, '/api/settings', 'POST', { settings: {} }, 403)
    const settings = await api(operator.context, '/api/settings')
    assert.equal(settings.data.settings.general.oidc.clientSecret, '')
    assert.equal(settings.data.settings.general.storage.s3.secretAccessKey, '')
    results.push(
      'Delegated settings edits are field-scoped and credentials are redacted'
    )
    const issued = await api(user.context, '/api/integrations', 'POST', {
      action: 'create-token',
      name: 'Role revocation test',
      scopes: ['files:read', 'files:upload'],
    })
    const tokenRequest = async (status) => {
      const r = await user.context.request.get(origin + '/api/files', {
        headers: { Authorization: `Bearer ${issued.secret}` },
      })
      assert.equal(r.status(), status, await r.text())
    }
    await tokenRequest(200)
    const bearerOnly = await browser.newContext()
    const bearerRead = await bearerOnly.request.get(origin + '/api/files', {
      headers: { Authorization: `Bearer ${issued.secret}` },
    })
    assert.equal(bearerRead.status(), 200)
    for (const path of [
      '/api/roles',
      '/api/users',
      '/api/settings/email',
      '/api/upload-profiles',
    ]) {
      const blocked = await bearerOnly.request.get(origin + path, {
        headers: { Authorization: `Bearer ${issued.secret}` },
      })
      assert.equal(blocked.status(), 401, `${path} must be session-only`)
    }
    await bearerOnly.close()
    await api(admin.context, `/api/roles/${creator.id}`, 'PATCH', {
      permissions: creator.permissions.filter(
        (permission) => permission !== 'files.read'
      ),
    })
    await tokenRequest(403)
    await api(user.context, '/api/files', 'GET', undefined, 403)
    await api(admin.context, `/api/roles/${creator.id}`, 'PATCH', {
      permissions: creator.permissions,
    })
    await tokenRequest(200)
    results.push(
      'Existing browser sessions and named tokens observe role changes on the next request'
    )
    await api(user.context, '/api/settings/email', 'GET', undefined, 403)
    await api(user.context, '/api/users', 'GET', undefined, 403)
    const scoped = await user.context.request.post(origin + '/api/roles', {
      headers: { Authorization: `Bearer ${issued.secret}` },
      data: { name: 'Token escalation', position: 1, permissions: [] },
    })
    assert.equal(scoped.status(), 403) // existing browser session is also unprivileged
    await api(admin.context, '/api/users', 'PUT', {
      id: member.id,
      roleIds: [creator.id, moderator.id],
    })
    const union = await api(user.context, '/api/auth/session')
    assert(
      union.user.permissions.includes('content.read') &&
        union.user.permissions.includes('files.upload')
    )
    results.push(
      'Multiple roles combine grants; management endpoints remain session-only'
    )
    await api(admin.context, `/api/roles/${creator.id}`, 'PATCH', {
      permissions: creator.permissions.filter(
        (permission) => permission !== 'files.share'
      ),
    })
    const upload = await user.context.request.post(origin + '/api/files', {
      multipart: {
        file: {
          name: 'role-permissions-demo.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('A private role permissions demonstration.\n'),
        },
        visibility: 'PUBLIC',
      },
    })
    assert.equal(upload.status(), 200, await upload.text())
    const files = await api(user.context, '/api/files')
    const privateFile = files.data.find(
      (file) => file.name === 'role-permissions-demo.txt'
    )
    assert.equal(privateFile.visibility, 'PRIVATE')
    await api(
      user.context,
      `/api/files/${privateFile.id}`,
      'PATCH',
      { visibility: 'PUBLIC' },
      403
    )
    results.push(
      'Upload without Share files permission stays private and cannot be made public'
    )
    await api(admin.context, `/api/roles/${creator.id}`, 'PATCH', {
      permissions: creator.permissions,
    })
    await api(admin.context, '/api/users', 'PUT', {
      id: member.id,
      roleIds: [],
    })
    const denied = [
      ['/api/roles', 'GET'],
      ['/api/users', 'GET'],
      ['/api/files', 'GET'],
      ['/api/urls', 'GET'],
      ['/api/urls', 'POST', { url: 'https://example.com' }],
      ['/api/folders', 'POST', { name: 'Denied' }],
      ['/api/tags', 'POST', { name: 'Denied' }],
      ['/api/upload-profiles', 'GET'],
      ['/api/upload-profiles', 'POST', {}],
      ['/api/profile/upload-token', 'GET'],
      ['/api/profile/export', 'GET'],
      ['/api/profile/export/progress', 'GET'],
      ['/api/profile/sharex', 'GET'],
      ['/api/profile', 'PUT', { name: 'Denied' }],
      ['/api/profile/avatar', 'POST'],
      ['/api/settings/email', 'GET'],
      ['/api/updates/check', 'GET'],
      ['/api/customization', 'POST', {}],
      ['/api/customization/assets', 'POST'],
      ['/api/customization/preferences', 'PATCH', { theme: 'dark' }],
      [
        '/api/integrations',
        'POST',
        { action: 'create-token', name: 'Denied', scopes: ['files:read'] },
      ],
      [
        '/api/integrations',
        'POST',
        {
          action: 'create-webhook',
          name: 'Denied',
          url: 'https://example.com/hook',
        },
      ],
      [`/api/files/${privateFile.id}`, 'DELETE'],
    ]
    for (const [path, method, body] of denied)
      await api(user.context, path, method, body, 403)
    await tokenRequest(403)
    results.push(
      `${denied.length} protected API actions reject a signed-in account with no grants`
    )
    await api(admin.context, '/api/users', 'PUT', {
      id: member.id,
      roleIds: [creator.id, moderator.id],
    })
    await api(admin.context, `/api/roles/${creator.id}`, 'PATCH', {
      permissions: creator.permissions.filter(
        (permission) => !['files.delete', 'files.share'].includes(permission)
      ),
    })
    for (const action of ['DELETE', 'SET_PRIVATE'])
      await api(
        user.context,
        `/api/files/${privateFile.id}/expiry`,
        'POST',
        { action, expiresAt: new Date(Date.now() + 3600000).toISOString() },
        403
      )
    results.push('Expiration cannot bypass delete or share permission')
    const link = (
      await api(admin.context, '/api/urls', 'POST', {
        url: 'https://example.com/role-moderation-demo',
      })
    ).data
    await api(
      user.context,
      `/api/users/${member.id}/urls/${link.id}`,
      'DELETE',
      undefined,
      404
    )
    await api(
      user.context,
      `/api/users/${session.user.id}/urls/${link.id}`,
      'DELETE',
      undefined,
      204
    )
    results.push(
      'Content moderators can delete links, with target ownership checked'
    )

    await api(admin.context, `/api/roles/${creator.id}`, 'PATCH', {
      permissions: creator.permissions,
    })
    await api(admin.context, `/api/roles/${everyone.id}`, 'PATCH', {
      permissions: original,
    })
    original = null
    console.log(
      JSON.stringify(
        {
          checks: results,
          fixtures: {
            memberId: member.id,
            creatorId: creator.id,
            moderatorId: moderator.id,
            supportId: support.id,
          },
        },
        null,
        2
      )
    )
  } finally {
    if (admin && original)
      await api(admin.context, `/api/roles/${everyone.id}`, 'PATCH', {
        permissions: original,
      }).catch(console.error)
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
