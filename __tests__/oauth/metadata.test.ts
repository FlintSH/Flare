import {
  GET as serverMetadata,
  OPTIONS as serverPreflight,
} from '@/app/.well-known/oauth-authorization-server/route'
import {
  GET as resourceMetadata,
  OPTIONS as resourcePreflight,
} from '@/app/.well-known/oauth-protected-resource/[[...resource]]/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { DEFAULT_CONFIG } from '@/lib/config'
import { API_SCOPES } from '@/lib/integrations/bearer-routes'
import { MCP_SCOPES } from '@/lib/mcp/catalog'
import {
  SIGN_IN_SCOPES,
  authorizationServerMetadata,
  bearerChallenge,
  isMcpResource,
  issuer,
  mcpResource,
  protectedResourceMetadata,
  signInScopes,
} from '@/lib/oauth/urls'

const mocks = vi.hoisted(() => ({ config: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
// The metadata endpoints read no cookie; these prove nothing asks.
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))

const APP = 'https://files.example.com'
const SCOPES = [
  'files:upload',
  'files:read',
  'files:content',
  'files:organize',
  'files:share',
  'files:delete',
  'urls:read',
  'urls:write',
]

const events: Partial<AuditInput>[] = []
let enabled = true

beforeEach(() => {
  vi.clearAllMocks()
  events.length = 0
  enabled = true
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
  vi.stubEnv('NEXTAUTH_URL', APP)
  mocks.config.mockImplementation(async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp.enabled = enabled
    return config
  })
})
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
})

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://10.0.0.5:3000${path}`, { headers })
const resource = (path: string[] | undefined, request = get('/')) =>
  resourceMetadata(request, { params: Promise.resolve({ resource: path }) })

describe('the issuer and the resource', () => {
  it('come from NEXTAUTH_URL, not from the request', () => {
    const request = get('/api/mcp', { host: 'attacker.example' })
    expect(issuer(request)).toBe(APP)
    expect(mcpResource(request)).toBe(`${APP}/api/mcp`)
  })

  it('drop a trailing slash and keep a path, as every generated link does', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example.com/')
    expect(issuer(get('/'))).toBe(APP)
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com/flare/')
    expect(issuer(get('/'))).toBe('https://example.com/flare')
    expect(mcpResource(get('/'))).toBe('https://example.com/flare/api/mcp')
  })

  it('fall back to the address of the request only when none is configured', () => {
    vi.stubEnv('NEXTAUTH_URL', '')
    expect(issuer(get('/api/mcp'))).toBe('http://10.0.0.5:3000')
    vi.stubEnv('NEXTAUTH_URL', 'not a url')
    expect(issuer(get('/api/mcp'))).toBe('http://10.0.0.5:3000')
  })

  it.each([
    [`${APP}/api/mcp`, true],
    [`${APP}/api/mcp/`, true],
    [`${APP}/api/mcp//`, true],
    [`${APP}/api/mcp?x=1`, false],
    [`${APP}/api/mcp/extra`, false],
    [`${APP}/api`, false],
    [`${APP}`, false],
    ['https://files.example.com.evil.example/api/mcp', false],
    ['http://files.example.com/api/mcp', false],
    // The same place, spelled as a client may spell it.
    ['HTTPS://FILES.EXAMPLE.COM/api/mcp', true],
    [`${APP}:443/api/mcp`, true],
    [`${APP}:8443/api/mcp`, false],
    [`${APP}/api/mcp#fragment`, false],
    ['https://user@files.example.com/api/mcp', false],
    [`${APP}/API/MCP`, false],
    [`${APP}/api%2Fmcp`, false],
    ['/api/mcp', false],
    ['', false],
  ])('reads the resource %j as the MCP endpoint: %s', (value, expected) => {
    expect(isMcpResource(value, get('/'))).toBe(expected)
  })
})

describe('the scopes a sign-in can grant', () => {
  it('are every scope MCP honors except the marker for named tokens', () => {
    expect(SIGN_IN_SCOPES).toEqual(SCOPES)
    expect(SIGN_IN_SCOPES).toEqual(
      MCP_SCOPES.filter((scope) => scope !== 'mcp')
    )
    expect(SIGN_IN_SCOPES).not.toContain('mcp')
  })

  it('keep catalog order and drop the marker and anything unknown', () => {
    expect(
      signInScopes(['urls:read', 'mcp', 'admin:everything', 'files:read'])
    ).toEqual(['files:read', 'urls:read'])
    expect(signInScopes([...API_SCOPES, ...API_SCOPES])).toEqual(SCOPES)
    expect(signInScopes([])).toEqual([])
  })
})

describe('the 401 challenge', () => {
  it('points at the resource metadata, from the configured address', () => {
    expect(bearerChallenge(get('/api/mcp', { host: 'attacker.example' }))).toBe(
      `Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/api/mcp"`
    )
  })

  it('names no scope: what an agent may do is chosen on the consent screen', () => {
    const challenge = bearerChallenge(get('/api/mcp'))
    expect(challenge).not.toMatch(/scope/i)
    expect(challenge).not.toMatch(/files:|urls:/)
    // The scopes there are to choose from are in the metadata it points at.
    expect(protectedResourceMetadata(get('/')).scopes_supported).toEqual(SCOPES)
    expect(authorizationServerMetadata(get('/')).scopes_supported).toEqual(
      SCOPES
    )
  })

  it('names a refused token as RFC 6750 does, before where to sign in', () => {
    expect(bearerChallenge(get('/api/mcp'), true)).toBe(
      `Bearer error="invalid_token", resource_metadata="${APP}/.well-known/oauth-protected-resource/api/mcp"`
    )
    // Without a token there is nothing to call invalid.
    expect(bearerChallenge(get('/api/mcp'), false)).not.toMatch(/error/)
    expect(bearerChallenge(get('/api/mcp'))).not.toMatch(/error/)
    expect(bearerChallenge(get('/api/mcp'), true)).not.toMatch(/scope/)
  })

  it('keeps a path the address has', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com/flare/')
    expect(bearerChallenge(get('/api/mcp'))).toBe(
      'Bearer resource_metadata="https://example.com/flare/.well-known/oauth-protected-resource/api/mcp"'
    )
  })
})

describe('protected resource metadata (RFC 9728)', () => {
  it('has exactly these fields', () => {
    expect(protectedResourceMetadata(get('/'))).toEqual({
      resource: `${APP}/api/mcp`,
      authorization_servers: [APP],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Flare',
    })
  })

  it.each<[string, string[] | undefined]>([
    ['the bare well-known path', undefined],
    ['the path of the MCP endpoint', ['api', 'mcp']],
  ])('is served at %s, to any site, uncached', async (_where, path) => {
    const response = await resource(path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(protectedResourceMetadata(get('/')))
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
  })

  it('is also served under the path of an address that has one', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com/flare')
    const response = await resource(['flare', 'api', 'mcp'])
    expect(response.status).toBe(200)
    expect((await response.json()).resource).toBe(
      'https://example.com/flare/api/mcp'
    )
  })

  it.each([
    [['api']],
    [['api', 'mcp', 'transfer']],
    [['api', 'files']],
    [['mcp']],
    [['API', 'MCP']],
    [['flare', 'api', 'mcp']],
  ])('is not found at %j: Flare protects nothing else', async (path) => {
    const response = await resource(path)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('answers 404 while the MCP server is off, and records nothing', async () => {
    enabled = false
    for (const path of [undefined, ['api', 'mcp']]) {
      const response = await resource(path)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not found' })
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
    }
    expect((await resourcePreflight()).status).toBe(404)
    await auditSettled()
    expect(events).toEqual([])
  })
})

describe('authorization server metadata (RFC 8414)', () => {
  it('has exactly these fields', () => {
    expect(authorizationServerMetadata(get('/'))).toEqual({
      issuer: APP,
      authorization_endpoint: `${APP}/api/oauth/authorize`,
      token_endpoint: `${APP}/api/oauth/token`,
      registration_endpoint: `${APP}/api/oauth/register`,
      revocation_endpoint: `${APP}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
      authorization_response_iss_parameter_supported: true,
    })
  })

  it('does not advertise client ID metadata documents, plain PKCE or client secrets', () => {
    const metadata = authorizationServerMetadata(get('/')) as Record<
      string,
      unknown
    >
    expect(metadata).not.toHaveProperty('client_id_metadata_document_supported')
    expect(metadata.code_challenge_methods_supported).not.toContain('plain')
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(metadata.scopes_supported).not.toContain('mcp')
  })

  it('is served to any site, uncached, from the configured address', async () => {
    const response = await serverMetadata(
      get('/.well-known/oauth-authorization-server', {
        host: 'attacker.example',
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(authorizationServerMetadata(get('/')))
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 404 while the MCP server is off', async () => {
    enabled = false
    const response = await serverMetadata(get('/'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect((await serverPreflight()).status).toBe(404)
  })
})

describe('the metadata endpoints', () => {
  it('answer a preflight that sends the protocol version', async () => {
    for (const preflight of [serverPreflight, resourcePreflight]) {
      const response = await preflight()
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, OPTIONS'
      )
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'MCP-Protocol-Version'
      )
    }
  })

  it('read no cookie and no session', async () => {
    const cookie = 'next-auth.session-token=an-administrator'
    await serverMetadata(get('/', { cookie }))
    await resource(['api', 'mcp'], get('/', { cookie }))
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('record nothing for a document that was served', async () => {
    await serverMetadata(get('/'))
    await resource(undefined)
    await auditSettled()
    expect(events).toEqual([])
  })
})
