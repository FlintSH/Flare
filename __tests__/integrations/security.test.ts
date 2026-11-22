import { createHmac } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  API_SCOPE_CATALOG,
  scopeUsable,
  scopeWorksOverApi,
} from '@/lib/integrations/bearer-routes'
import {
  WebhookTargetError,
  isPublicAddress,
  parseWebhookUrl,
  resolveWebhookTarget,
  signWebhook,
} from '@/lib/integrations/security'
import {
  createRandomApiToken,
  createWebhookSecret,
  hashApiToken,
  tokenAllowsRequest,
  tokenUsable,
} from '@/lib/integrations/tokens'
import type { Permission } from '@/lib/permissions/catalog'

const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => dns)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('scoped API tokens', () => {
  it('reveals a high entropy key whose persisted hash is independent of the secret', () => {
    const first = createRandomApiToken()
    const second = createRandomApiToken()
    expect(first.token).toMatch(/^flr_[\w-]{43}$/)
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashApiToken(first.token)).toBe(first.hash)
    expect(first.token).not.toBe(second.token)
    expect(first.hash).not.toBe(second.hash)
  })
  it('accepts a token until it is revoked or reaches its expiry', () => {
    const now = Date.now()
    const token = (revokedAt: Date | null, expiresAt: Date | null) =>
      tokenUsable({ revokedAt, expiresAt })
    expect(token(null, null)).toBe(true)
    expect(token(null, new Date(now + 60_000))).toBe(true)
    expect(token(null, new Date(now - 1))).toBe(false)
    expect(token(new Date(now - 60_000), null)).toBe(false)
  })
  it('mints high entropy webhook signing secrets', () => {
    const secret = createWebhookSecret()
    expect(secret).toMatch(/^whsec_[\w-]{43}$/)
    expect(createWebhookSecret()).not.toBe(secret)
  })
  it('offers a scope over REST while the owner can use at least one of its REST routes', () => {
    const usable = (granted: Permission[]) =>
      API_SCOPE_CATALOG.map(({ scope }) => scope).filter((scope) =>
        scopeUsable(scope, (permission) => granted.includes(permission))
      )
    expect(usable(['files.upload', 'files.read', 'links.read'])).toEqual([
      'files:upload',
      'files:read',
      'urls:read',
    ])
    expect(usable(['links.create'])).toEqual(['urls:write'])
    expect(usable(['links.delete'])).toEqual(['urls:write'])
    expect(usable(['tokens.manage', 'files.update', 'tags.manage'])).toEqual([])
  })
  it('never offers over REST a scope only the MCP server honors, whatever the role allows', () => {
    // `scopeAvailable` in lib/mcp/catalog.ts decides whether MCP makes them usable.
    const mcpOnly = API_SCOPE_CATALOG.filter(
      ({ surfaces }) => !(surfaces as readonly string[]).includes('api')
    ).map(({ scope }) => scope)
    expect(mcpOnly).toEqual([
      'files:content',
      'files:organize',
      'files:share',
      'files:delete',
      'account:write',
      'invites:write',
      'admin:read',
      'admin:users',
      'admin:content',
      'admin:settings',
      'mcp',
    ])
    for (const scope of mcpOnly) {
      expect(
        scopeUsable(scope, () => true),
        scope
      ).toBe(false)
      expect(scopeWorksOverApi(scope), scope).toBe(false)
    }
    // The four scopes named tokens had before MCP still work over REST.
    expect(
      API_SCOPE_CATALOG.filter(({ scope }) => scopeWorksOverApi(scope)).map(
        ({ scope }) => scope
      )
    ).toEqual(['files:upload', 'files:read', 'urls:read', 'urls:write'])
  })
  it('gives no REST route to a token that holds only MCP scopes', () => {
    const scopes = [
      'files:content',
      'files:organize',
      'files:share',
      'files:delete',
      'account:write',
      'mcp',
    ]
    for (const [method, path] of [
      ['GET', '/api/files'],
      ['POST', '/api/files'],
      ['DELETE', '/api/files/abc'],
      ['PATCH', '/api/files/abc'],
      ['GET', '/api/urls'],
      // Changing account settings is a scope for agents: it opens no
      // account route to a named token.
      ['PUT', '/api/profile'],
      ['DELETE', '/api/profile'],
      ['GET', '/api/profile/export'],
      ['POST', '/api/profile/avatar'],
      ['POST', '/api/upload-profiles'],
      ['POST', '/api/mcp'],
    ])
      expect(
        tokenAllowsRequest(scopes, { method, url: `https://flare.test${path}` })
      ).toBe(false)
  })
  it('gives no REST route at all to a token with invites and administration scopes', () => {
    const scopes = [
      'invites:write',
      'admin:read',
      'admin:users',
      'admin:content',
      'admin:settings',
      'mcp',
    ]
    const app = resolve(process.cwd(), 'app')
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(directory, entry.name))
          : [join(directory, entry.name)]
      )
    const paths = walk(join(app, 'api'))
      .filter((file) => file.endsWith('/route.ts'))
      .map(
        (file) =>
          '/' +
          relative(app, file)
            .replace(/\/route\.ts$/, '')
            .replace(/\[[^\]]+\]/g, 'abc')
      )
    // The administration routes are among them.
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/users',
        '/api/users/abc',
        '/api/roles',
        '/api/invites',
        '/api/settings',
        '/api/audit',
        '/api/users/abc/files',
      ])
    )
    for (const path of paths)
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        expect(
          tokenAllowsRequest(scopes, {
            method,
            url: `https://flare.test${path}`,
          }),
          `${method} ${path}`
        ).toBe(false)
    for (const scope of scopes) {
      expect(scopeWorksOverApi(scope), scope).toBe(false)
      expect(
        scopeUsable(scope, () => true),
        scope
      ).toBe(false)
    }
  })
  it('allows only exact route/method combinations and never account or token management', () => {
    const allowed = (method: string, path: string, scopes = ['files:upload']) =>
      tokenAllowsRequest(scopes, { method, url: `https://flare.test${path}` })
    expect(allowed('POST', '/api/files')).toBe(true)
    expect(allowed('PUT', '/api/files/chunks/abc/part/1')).toBe(true)
    expect(allowed('POST', '/api/files/chunks/abc/complete')).toBe(true)
    expect(allowed('GET', '/api/files')).toBe(false)
    expect(allowed('POST', '/api/files', ['files:read'])).toBe(false)
    expect(allowed('GET', '/api/files', ['files:read'])).toBe(true)
    expect(allowed('GET', '/api/files/timeline', ['files:read'])).toBe(true)
    expect(allowed('GET', '/api/files/timeline', ['files:upload'])).toBe(false)
    expect(allowed('POST', '/api/files/timeline', ['files:read'])).toBe(false)
    for (const path of [
      '/api/profile',
      '/api/profile/upload-token',
      '/api/profile/sharex',
      '/api/profile/bash',
      '/api/settings',
      '/api/users',
      '/api/integrations',
      '/api/files/a/password',
      '/api/files/tags',
      '/api/files/chunks/a%2fb/complete',
      '/api/files/',
    ]) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE'])
        expect(
          allowed(method, path, [
            'files:read',
            'files:upload',
            'urls:read',
            'urls:write',
          ])
        ).toBe(false)
    }
    expect(allowed('DELETE', '/api/urls/abc', ['urls:write'])).toBe(true)
    expect(allowed('GET', '/api/urls/abc', ['urls:read'])).toBe(false)
  })
})

describe('webhook destination and signing contracts', () => {
  it('authenticates the timestamp and exact body', () => {
    const body = '{"id":"file.ready:123"}'
    const expected = createHmac('sha256', 'test-secret')
      .update(`123.${body}`)
      .digest('hex')
    expect(signWebhook('test-secret', '123', body)).toBe(`v1=${expected}`)
    expect(signWebhook('test-secret', '124', body)).not.toBe(`v1=${expected}`)
    expect(signWebhook('test-secret', '123', body + ' ')).not.toBe(
      `v1=${expected}`
    )
  })
  it('rejects private, loopback, mapped and transition addresses', () => {
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.2.3.4',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fe80::1',
      'fc00::1',
      '2001::1',
      '2001:0db8::1',
      '2002:7f00:1::',
    ])
      expect(isPublicAddress(address), address).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('requires explicit operator opt-in for HTTP or internal DNS answers', async () => {
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', '')
    expect(() => parseWebhookUrl('http://localhost:8080/hook')).toThrow('HTTPS')
    expect(() => parseWebhookUrl('https://user:pass@example.com/hook')).toThrow(
      'credentials'
    )
    expect(() => parseWebhookUrl('https://example.com/hook#fragment')).toThrow(
      'fragments'
    )
    dns.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(
      resolveWebhookTarget('https://example.com/hook')
    ).rejects.toThrow('public IP')
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', 'true')
    await expect(
      resolveWebhookTarget('http://localhost/hook')
    ).resolves.toMatchObject({ address: { address: '8.8.8.8' } })
  })
  it('rechecks DNS for every delivery', async () => {
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', '')
    dns.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    await expect(
      resolveWebhookTarget('https://example.com')
    ).resolves.toBeDefined()
    await expect(resolveWebhookTarget('https://example.com')).rejects.toThrow(
      'public IP'
    )
    expect(dns.lookup).toHaveBeenCalledTimes(2)
  })
  it('refuses an unusable destination with a 400 for the person adding it', async () => {
    vi.stubEnv('FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK', '')
    expect(() => parseWebhookUrl('not a url')).toThrow(WebhookTargetError)
    dns.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    await expect(
      resolveWebhookTarget('https://example.com/hook')
    ).rejects.toMatchObject({ status: 400 })
    // A name that doesn't resolve keeps the lookup's own explanation.
    dns.lookup.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND hooks.invalid'), {
        code: 'ENOTFOUND',
      })
    )
    const missing = await resolveWebhookTarget(
      'https://hooks.invalid/hook'
    ).catch((error: unknown) => error)
    expect(missing).toBeInstanceOf(WebhookTargetError)
    expect(missing).toMatchObject({
      status: 400,
      message: 'getaddrinfo ENOTFOUND hooks.invalid',
    })
  })
})
