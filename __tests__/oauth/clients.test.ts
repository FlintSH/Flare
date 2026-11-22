import { OPTIONS, POST } from '@/app/api/oauth/register/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { DEFAULT_CONFIG } from '@/lib/config'
import {
  DEFAULT_CLIENT_NAME,
  cleanClientName,
  isClientId,
  onOwnOrigin,
  readRegistration,
  redirectMatches,
  redirectUriProblem,
} from '@/lib/oauth/clients'
import { OAuthError } from '@/lib/oauth/http'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  session: vi.fn(),
  create: vi.fn(),
  limits: new Map<string, number>(),
  limitCalls: [] as Array<{ key: string; limit: number; seconds: number }>,
}))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { oAuthClient: { create: mocks.create } },
}))
// The limiter's own counting is tested against PostgreSQL; here it counts in
// memory, so a test can spend an allowance.
vi.mock('@/lib/security/database-limit', () => ({
  consumeLimit: async (
    table: string,
    key: string,
    limit: number,
    seconds: number
  ) => {
    expect(table).toBe('AuthRateLimit')
    mocks.limitCalls.push({ key, limit, seconds })
    const count = (mocks.limits.get(key) ?? 0) + 1
    mocks.limits.set(key, count)
    return { allowed: count <= limit, resetsIn: 1800 }
  },
}))

const APP = 'https://files.example.com'
const events: Partial<AuditInput>[] = []
let enabled = true

beforeEach(() => {
  vi.clearAllMocks()
  mocks.limits.clear()
  mocks.limitCalls.length = 0
  events.length = 0
  enabled = true
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
  vi.stubEnv('NEXTAUTH_URL', APP)
  vi.stubEnv('FLARE_CLIENT_IP_HEADER', '')
  mocks.config.mockImplementation(async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp.enabled = enabled
    return config
  })
  mocks.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      createdAt: new Date(),
      usedAt: null,
      ...data,
    })
  )
})
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
})

const register = (
  body: unknown,
  { address = '203.0.113.9', headers = {} as Record<string, string> } = {}
) =>
  POST(
    new Request(`${APP}/api/oauth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': address,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

describe('redirect addresses a client may register', () => {
  it.each([
    // https, to any host.
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://vscode.dev/redirect',
    'https://app.example.com:8443/cb?tenant=a',
    'https://localhost/callback',
    'https://xn--bcher-kva.example/cb',
    // http, on this computer only.
    'http://localhost:8787/callback',
    'http://localhost/callback',
    'http://localhost:3000',
    'http://127.0.0.1:33418/',
    'http://127.0.0.1:54321/callback',
    'http://[::1]:9000/cb',
    'HTTP://LOCALHOST:8787/callback',
    // An app's private scheme (RFC 8252).
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.github-authentication/did-authenticate',
    'com.example.app:/oauth2redirect',
    'myapp:callback',
  ])('allows %s', (uri) => {
    expect(redirectUriProblem(uri)).toBeNull()
  })

  it.each([
    // Schemes a browser handles itself.
    ['javascript:alert(document.cookie)', /javascript scheme/],
    ['JavaScript:alert(1)', /javascript scheme/],
    ['javascript://claude.ai/%0aalert(1)', /javascript scheme/],
    ['data:text/html,<script>alert(1)</script>', /data scheme/],
    ['file:///etc/passwd', /file scheme/],
    ['blob:https://files.example.com/1b2c', /blob scheme/],
    ['about:blank', /about scheme/],
    ['vbscript:msgbox(1)', /vbscript scheme/],
    ['view-source:https://files.example.com/', /view-source scheme/],
    ['filesystem:https://files.example.com/x', /filesystem scheme/],
    ['ws://localhost:3000/cb', /ws scheme/],
    ['wss://example.com/cb', /wss scheme/],
    ['ftp://example.com/cb', /ftp scheme/],
    ['mailto:someone@example.com', /mailto scheme/],
    // http anywhere but this computer.
    ['http://example.com/callback', /http only on localhost/],
    ['http://claude.ai/api/mcp/auth_callback', /http only on localhost/],
    ['http://192.168.1.10:8080/cb', /http only on localhost/],
    ['http://10.0.0.1/cb', /http only on localhost/],
    ['http://0.0.0.0:8080/cb', /http only on localhost/],
    ['http://localhost.example.com/cb', /http only on localhost/],
    ['http://localhost.:3000/cb', /http only on localhost/],
    ['http://127.0.0.1.nip.io/cb', /http only on localhost/],
    ['http://[::ffff:127.0.0.1]/cb', /http only on localhost/],
    ['http://[::2]/cb', /http only on localhost/],
    // A fragment, which is where the answer would be hidden from the server.
    ['https://claude.ai/cb#fragment', /fragment/],
    ['https://claude.ai/cb#', /fragment/],
    ['http://localhost:8787/callback#x', /fragment/],
    ['cursor://anysphere.cursor-mcp/oauth/callback#x', /fragment/],
    // Credentials in the address.
    ['https://user@claude.ai/cb', /user name or password/],
    ['https://user:secret@claude.ai/cb', /user name or password/],
    ['https://claude.ai@evil.example/cb', /user name or password/],
    ['http://user@localhost:8787/callback', /user name or password/],
    // Text a URL parser would silently change.
    ['java\tscript:alert(1)', /control character/],
    [' javascript:alert(1)', /space/],
    ['https://claude.ai/cb ', /space/],
    ['https://claude.ai/cb\n', /control character/],
    ['https://claude.ai\\@evil.example/cb', /backslash/],
    ['https://claude.ai/\u0000cb', /control character/],
    // Not an absolute URL.
    ['/callback', /not an absolute URL/],
    ['//evil.example/callback', /not an absolute URL/],
    ['claude.ai/callback', /not an absolute URL/],
    ['https:claude.ai/cb', /not an absolute URL/],
    ['https:/claude.ai/cb', /not an absolute URL/],
    ['https://', /not an absolute URL/],
    ['http://localhost:99999/cb', /not an absolute URL/],
    ['', /space, a backslash or a control character/],
  ])('refuses %j', (uri, reason) => {
    expect(redirectUriProblem(uri)).toMatch(reason)
  })

  it('refuses an address longer than 512 characters, and takes one of exactly 512', () => {
    const base = 'https://claude.ai/'
    expect(redirectUriProblem(base + 'a'.repeat(512 - base.length))).toBeNull()
    expect(redirectUriProblem(base + 'a'.repeat(513 - base.length))).toMatch(
      /longer than 512 characters/
    )
  })
})

describe('schemes a client may return to', () => {
  // An app's own scheme, with or without a dot in it.
  it.each([
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.github-authentication/did-authenticate',
    'vscode-insiders://vscode.github-authentication/did-authenticate',
    'windsurf://codeium.windsurf/oauth/callback',
    'zed://oauth/callback',
    'claude://oauth/callback',
    'codex://oauth/callback',
    'raycast://oauth',
    'com.example.app:/oauth2redirect',
    'io.github.someone.client://callback',
    'myapp:callback',
    'msteams-like-but-not://callback',
    'm://callback',
  ])('accepts %s', (uri) => {
    expect(redirectUriProblem(uri)).toBeNull()
  })

  // Handled by the browser or the operating system, which act on the address.
  it.each([
    'javascript',
    'data',
    'file',
    'blob',
    'about',
    'vbscript',
    'view-source',
    'filesystem',
    'chrome',
    'chrome-extension',
    'moz-extension',
    'resource',
    'res',
    'jar',
    'ws',
    'wss',
    'ftp',
    'mailto',
    'tel',
    'sms',
    'facetime',
    'facetime-audio',
    'callto',
    'sip',
    'sips',
    'smb',
    'nfs',
    'afp',
    'ssh',
    'sftp',
    'telnet',
    'ldap',
    'ldaps',
    'shell',
    'search-ms',
    'microsoft-edge',
    'itms',
    'itms-apps',
    'itms-services',
    'shortcuts',
    'x-apple.systempreferences',
    'intent',
    'android-app',
    'steam',
    'vscode-webview',
    // Any scheme of the Windows family.
    'ms-msdt',
    'ms-officecmd',
    'ms-settings',
    'ms-word',
    'ms-excel',
    'ms-search',
    'ms-appinstaller',
    'ms-',
  ])('refuses the %s scheme, in any letter case and shape', (scheme) => {
    for (const uri of [
      `${scheme}://host/callback`,
      `${scheme}:/callback`,
      `${scheme}:callback`,
      `${scheme.toUpperCase()}://host/callback`,
    ])
      expect(redirectUriProblem(uri), uri).toBe(
        `A redirect URI cannot use the ${scheme} scheme.`
      )
  })

  it('refuses the same schemes at registration and when a sign-in presents them', () => {
    for (const uri of [
      'ms-msdt:/id PCWDiagnostic',
      'intent://scan/#Intent;end',
    ]) {
      expect(redirectUriProblem(uri)).not.toBeNull()
      expect(redirectMatches([uri], uri)).toBe(false)
    }
    for (const uri of ['search-ms:query=x', 'itms-services://?action=download'])
      expect(redirectMatches([uri], uri)).toBe(false)
    // An ordinary app scheme next to them is untouched.
    expect(
      redirectMatches(['zed://oauth/callback'], 'zed://oauth/callback')
    ).toBe(true)
  })
})

describe("a redirect address on this instance's own origin", () => {
  const ISSUER = 'https://files.example.com'

  it.each([
    'https://files.example.com/u/abc123',
    'https://files.example.com/',
    'https://files.example.com',
    'https://files.example.com/alex/report.pdf/raw',
    // The same origin, written differently.
    'https://files.example.com:443/u/abc123',
    'https://FILES.EXAMPLE.COM/u/abc123',
    'HTTPS://Files.Example.Com:443/u/abc123',
    // A dot at the end of a host name names the same host.
    'https://files.example.com./u/abc123',
    'https://files.example.com.:443/u/abc123',
  ])('is refused: %s', (uri) => {
    expect(onOwnOrigin(uri, ISSUER)).toBe(true)
    expect(redirectUriProblem(uri, ISSUER)).toBe(
      'A redirect URI cannot be an address of this Flare instance.'
    )
  })

  it.each([
    // Another port, scheme or host is another origin.
    'https://files.example.com:8443/callback',
    'https://app.files.example.com/callback',
    'https://example.com/callback',
    'https://files.example.com.evil.example/callback',
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost:8787/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'com.example.app:/oauth2redirect',
  ])('is not what %s is', (uri) => {
    expect(onOwnOrigin(uri, ISSUER)).toBe(false)
    expect(redirectUriProblem(uri, ISSUER)).toBeNull()
  })

  it('follows the address the instance is served at, a path and a trailing slash included', () => {
    expect(
      onOwnOrigin('https://example.com/other', 'https://example.com/flare')
    ).toBe(true)
    expect(onOwnOrigin('https://example.com/x', 'https://example.com/')).toBe(
      true
    )
    expect(
      onOwnOrigin('https://example.com:444/x', 'https://example.com:444')
    ).toBe(true)
    expect(
      onOwnOrigin('https://example.com/x', 'https://example.com:444')
    ).toBe(false)
  })

  it('counts every name of this computer when the instance is served on it', () => {
    const local = 'http://localhost:3199'
    for (const uri of [
      'http://localhost:3199/callback',
      'http://127.0.0.1:3199/callback',
      'http://[::1]:3199/callback',
      'http://LOCALHOST:3199/u/abc',
    ])
      expect(onOwnOrigin(uri, local), uri).toBe(true)
    for (const uri of [
      'http://localhost:8787/callback',
      'http://127.0.0.1:3198/callback',
      'http://localhost/callback',
      'https://localhost:3199/callback',
    ])
      expect(onOwnOrigin(uri, local), uri).toBe(false)
    // A public instance has nothing to do with a client's loopback port.
    expect(onOwnOrigin('http://localhost:443/callback', ISSUER)).toBe(false)
  })

  it('is never true for something that is not a URL', () => {
    expect(onOwnOrigin('not a url', ISSUER)).toBe(false)
    expect(onOwnOrigin('https://files.example.com/', 'not a url')).toBe(false)
  })
})

describe('a redirect address that already has a parameter Flare adds', () => {
  it.each(['code', 'state', 'iss', 'error', 'error_description', 'error_uri'])(
    'is refused for %s, which would come back twice',
    (name) => {
      for (const uri of [
        `https://app.example/cb?${name}=mine`,
        `https://app.example/cb?tenant=a&${name}=`,
        `http://localhost:8787/callback?${name}`,
        `cursor://anysphere.cursor-mcp/oauth/callback?${name}=x`,
        `myapp:callback?${name}=x`,
      ])
        expect(redirectUriProblem(uri), uri).toBe(
          `A redirect URI must not have a "${name}" parameter of its own: Flare adds one.`
        )
    }
  )

  it('leaves every other parameter alone', () => {
    for (const uri of [
      'https://app.example/cb?tenant=acme%20corp&next=%2Fhome',
      'https://app.example/cb?codes=1&status=2&issuer=3&errors=4',
      'https://app.example/cb?CODE=1',
      'https://app.example/code/state?x=1',
    ])
      expect(redirectUriProblem(uri), uri).toBeNull()
  })
})

describe('matching a redirect address at sign-in', () => {
  const claude = ['https://claude.ai/api/mcp/auth_callback']
  const local = ['http://localhost:8787/callback', 'http://127.0.0.1:33418/']
  const cursor = ['cursor://anysphere.cursor-mcp/oauth/callback']

  it('accepts the registered address exactly', () => {
    expect(redirectMatches(claude, claude[0])).toBe(true)
    expect(redirectMatches(local, local[0])).toBe(true)
    expect(redirectMatches(local, local[1])).toBe(true)
    expect(redirectMatches(cursor, cursor[0])).toBe(true)
  })

  it('ignores the port of http on a loopback host, and nothing else about it', () => {
    expect(redirectMatches(local, 'http://localhost:51234/callback')).toBe(true)
    expect(redirectMatches(local, 'http://localhost/callback')).toBe(true)
    expect(redirectMatches(local, 'http://127.0.0.1:1/')).toBe(true)
    expect(redirectMatches(['http://[::1]/cb'], 'http://[::1]:8000/cb')).toBe(
      true
    )
    // A registration without a port takes any port too.
    expect(
      redirectMatches(
        ['http://localhost/callback'],
        'http://localhost:9/callback'
      )
    ).toBe(true)
  })

  it.each([
    // Another path.
    'http://localhost:8787/other',
    'http://localhost:8787/callback/',
    'http://localhost:8787/callback/extra',
    'http://localhost:8787/',
    'http://localhost:8787/CALLBACK',
    // Another host: localhost and 127.0.0.1 are different names.
    'http://127.0.0.1:8787/callback',
    'http://[::1]:8787/callback',
    'http://localhost.example.com:8787/callback',
    'http://example.com:8787/callback',
    'http://localhost:33418/',
    // Another scheme.
    'https://localhost:8787/callback',
    'ws://localhost:8787/callback',
    // An added query, fragment or user name.
    'http://localhost:8787/callback?next=https://evil.example',
    'http://localhost:8787/callback?',
    'http://localhost:8787/callback#fragment',
    'http://user@localhost:8787/callback',
    'http://localhost:8787@evil.example/callback',
    // Text a parser would change into a match.
    'http://localhost:8787/callback\n',
    ' http://localhost:8787/callback',
    'http://localhost:8787\\callback',
    'http:localhost:8787/callback',
  ])('refuses %j for a client that registered loopback addresses', (uri) => {
    expect(redirectMatches(local, uri)).toBe(false)
  })

  it.each([
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://claude.ai/api/mcp/auth_callback#x',
    'https://claude.ai:8443/api/mcp/auth_callback',
    'https://claude.ai:443/api/mcp/auth_callback',
    'https://CLAUDE.AI/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/../mcp/auth_callback',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'https://evil.example/api/mcp/auth_callback',
    'https://claude.ai@evil.example/api/mcp/auth_callback',
    'http://claude.ai/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callbac',
    'https://claude.ai/',
    '',
  ])('refuses %j for a client that registered an https address', (uri) => {
    expect(redirectMatches(claude, uri)).toBe(false)
  })

  it('never ignores the port of https, or of a private scheme', () => {
    expect(
      redirectMatches(
        ['https://localhost:8787/cb'],
        'https://localhost:9999/cb'
      )
    ).toBe(false)
    expect(
      redirectMatches(cursor, 'cursor://anysphere.cursor-mcp:1/oauth/callback')
    ).toBe(false)
    expect(redirectMatches(cursor, 'cursor://evil/oauth/callback')).toBe(false)
  })

  it('matches nothing for a client with no addresses', () => {
    expect(redirectMatches([], 'http://localhost/callback')).toBe(false)
  })
})

describe('a client name', () => {
  it.each([
    ['Claude', 'Claude'],
    ['  Claude Code  ', 'Claude Code'],
    ['Claude\nCode\t(flare)', 'Claude Code (flare)'],
    ['Cla\u0000ude\u0007', 'Cla ude'],
    // Characters that draw nothing or reorder the text beside them.
    ['Claude‮edoc', 'Claudeedoc'],
    ['Cl​aude﻿', 'Claude'],
    ['Line one Line two', 'Line one Line two'],
    ['', DEFAULT_CLIENT_NAME],
    ['   ', DEFAULT_CLIENT_NAME],
    ['​‮', DEFAULT_CLIENT_NAME],
  ])('stores %j as %j', (given, stored) => {
    expect(cleanClientName(given)).toBe(stored)
  })

  it('is Unnamed client when the registration names none', () => {
    expect(DEFAULT_CLIENT_NAME).toBe('Unnamed client')
    expect(cleanClientName(undefined)).toBe('Unnamed client')
    expect(cleanClientName(null)).toBe('Unnamed client')
  })

  it('keeps at most 80 characters, without cutting one in half', () => {
    expect(cleanClientName('a'.repeat(80))).toHaveLength(80)
    expect(cleanClientName('a'.repeat(81))).toHaveLength(80)
    const emoji = cleanClientName('😀'.repeat(100))
    expect([...emoji]).toHaveLength(80)
    expect(emoji).toBe('😀'.repeat(80))
  })
})

describe('a client_id', () => {
  it('is the prefix and 43 base64url characters', () => {
    expect(isClientId(`flc_${'a'.repeat(43)}`)).toBe(true)
    expect(isClientId(`flc_${'A-_9'.repeat(10)}abc`)).toBe(true)
    for (const value of [
      `flc_${'a'.repeat(42)}`,
      `flc_${'a'.repeat(44)}`,
      `flr_${'a'.repeat(43)}`,
      `FLC_${'a'.repeat(43)}`,
      `flc_${'a'.repeat(42)}=`,
      `flc_${'a'.repeat(42)}\n`,
      'https://client.example/metadata.json',
      '',
      null,
      undefined,
      false,
      42,
    ])
      expect(isClientId(value), String(value)).toBe(false)
  })
})

describe('reading a registration', () => {
  const error = (body: unknown) => {
    try {
      readRegistration(body)
    } catch (thrown) {
      return thrown as OAuthError
    }
    throw new Error('Expected the registration to be refused')
  }

  it('needs at least one redirect address', () => {
    for (const body of [
      {},
      { redirect_uris: [] },
      { redirect_uris: null },
      { redirect_uris: 'https://claude.ai/cb' },
      { redirect_uris: [42] },
      { client_name: 'No addresses' },
    ]) {
      const refused = error(body)
      expect([refused.status, refused.code]).toEqual([
        400,
        'invalid_redirect_uri',
      ])
    }
  })

  it('takes ten redirect addresses and refuses eleven', () => {
    const uris = (count: number) =>
      Array.from({ length: count }, (_, index) => `https://a.example/${index}`)
    expect(readRegistration({ redirect_uris: uris(10) }).redirectUris).toEqual(
      uris(10)
    )
    expect(error({ redirect_uris: uris(11) }).code).toBe('invalid_redirect_uri')
  })

  it('refuses the whole registration for one bad address among good ones', () => {
    const refused = error({
      redirect_uris: [
        'https://claude.ai/api/mcp/auth_callback',
        'javascript:alert(1)',
      ],
    })
    expect(refused.code).toBe('invalid_redirect_uri')
    expect(refused.message).toMatch(/javascript scheme/)
  })

  it('lists an address once however often it is sent', () => {
    expect(
      readRegistration({
        redirect_uris: ['https://a.example/cb', 'https://a.example/cb'],
      }).redirectUris
    ).toEqual(['https://a.example/cb'])
  })

  it('accepts grant and response types only when they include what Flare supports', () => {
    const base = { redirect_uris: ['https://a.example/cb'] }
    for (const fine of [
      {},
      { grant_types: ['authorization_code'] },
      { grant_types: ['authorization_code', 'refresh_token'] },
      { grant_types: ['refresh_token', 'authorization_code', 'implicit'] },
      { response_types: ['code'] },
      { response_types: ['code', 'token'] },
      { grant_types: null, response_types: null },
    ])
      expect(() => readRegistration({ ...base, ...fine })).not.toThrow()
    for (const [bad, message] of [
      [{ grant_types: ['client_credentials'] }, /authorization_code/],
      [{ grant_types: ['refresh_token'] }, /authorization_code/],
      [{ grant_types: [] }, /authorization_code/],
      [{ response_types: ['token'] }, /response_types must include code/],
      [{ response_types: [] }, /response_types must include code/],
    ] as const) {
      const refused = error({ ...base, ...bad })
      expect(refused.code).toBe('invalid_client_metadata')
      expect(refused.message).toMatch(message)
    }
  })

  it('refuses metadata of the wrong shape', () => {
    const base = { redirect_uris: ['https://a.example/cb'] }
    for (const bad of [
      { client_name: 42 },
      { client_name: ['Claude'] },
      { grant_types: 'authorization_code' },
      { response_types: 'code' },
    ])
      expect(error({ ...base, ...bad }).code).toBe('invalid_client_metadata')
    for (const body of [null, 'text', 42, [], [base]]) {
      const refused = error(body)
      expect(refused.code).toBe('invalid_client_metadata')
      expect(refused.message).toBe('The registration must be a JSON object.')
    }
  })

  it('ignores fields it does not use, whatever they hold', () => {
    expect(
      readRegistration({
        redirect_uris: ['https://a.example/cb'],
        token_endpoint_auth_method: { nested: true },
        client_secret: 'a-secret-the-client-made-up',
        scope: 42,
        jwks_uri: 'https://attacker.example/jwks',
        software_statement: 'x.y.z',
        logo_uri: 'javascript:alert(1)',
        __proto__: { polluted: true },
      })
    ).toEqual({
      name: 'Unnamed client',
      redirectUris: ['https://a.example/cb'],
    })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})

describe('POST /api/oauth/register', () => {
  it('registers a client and answers what it registered, with 201', async () => {
    const response = await register({
      client_name: 'Example client',
      redirect_uris: ['http://localhost:8787/callback'],
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({
      client_id: expect.stringMatching(/^flc_[A-Za-z0-9_-]{43}$/),
      client_name: 'Example client',
      redirect_uris: ['http://localhost:8787/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    expect(body).not.toHaveProperty('client_secret')
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: body.client_id,
        name: 'Example client',
        redirectUris: ['http://localhost:8787/callback'],
      },
    })
  })

  it('gives every registration its own client_id', async () => {
    const body = { redirect_uris: ['https://a.example/cb'] }
    const ids = new Set<string>()
    for (let index = 0; index < 5; index++)
      ids.add((await (await register(body)).json()).client_id)
    expect(ids.size).toBe(5)
  })

  it.each([
    'client_secret_post',
    'client_secret_basic',
    'private_key_jwt',
    'none',
    undefined,
  ])(
    'answers a client that asked for %s as a public client, with no secret',
    async (method) => {
      const response = await register({
        redirect_uris: ['https://a.example/cb'],
        ...(method && { token_endpoint_auth_method: method }),
      })
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.token_endpoint_auth_method).toBe('none')
      expect(body).not.toHaveProperty('client_secret')
    }
  )

  it('can be called from any site, reads no cookie, and is never cached', async () => {
    const response = await register(
      { redirect_uris: ['https://a.example/cb'] },
      {
        headers: {
          origin: 'https://claude.ai',
          cookie: 'next-auth.session-token=an-administrator',
        },
      }
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('answers a preflight for a JSON post', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS'
    )
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'Content-Type, Authorization'
    )
  })

  it('answers 404 while the MCP server is off, and registers nothing', async () => {
    enabled = false
    const response = await register({ redirect_uris: ['https://a.example/cb'] })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect((await OPTIONS()).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.limitCalls).toEqual([])
    await auditSettled()
    expect(events).toEqual([])
  })

  it.each([
    [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['http://example.com/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb#x'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ client_name: 'Nothing else' }, 'invalid_redirect_uri'],
    [
      { redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] },
      'invalid_client_metadata',
    ],
    ['{not json', 'invalid_client_metadata'],
    ['', 'invalid_client_metadata'],
    ['[]', 'invalid_client_metadata'],
  ])('refuses %j with %s, and stores nothing', async (body, code) => {
    const response = await register(body)
    expect(response.status).toBe(400)
    const answer = await response.json()
    expect(answer.error).toBe(code)
    expect(answer.error_description).toEqual(expect.any(String))
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.create).not.toHaveBeenCalled()
    // A registration that is refused spends nobody's allowance.
    expect(mocks.limitCalls).toEqual([])
  })

  it.each([
    'https://files.example.com/u/abc123',
    'https://files.example.com:443/alex/notes.txt',
    'https://FILES.EXAMPLE.COM/auth/login',
  ])(
    "refuses %s: no client returns to this instance's own address",
    async (uri) => {
      for (const uris of [
        [uri],
        ['https://claude.ai/api/mcp/auth_callback', uri],
      ]) {
        const response = await register({ redirect_uris: uris })
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
          error: 'invalid_redirect_uri',
          error_description:
            'A redirect URI cannot be an address of this Flare instance.',
        })
      }
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it('judges its own address by the one it is configured with, not the one the request names', async () => {
    // Reached under another name, the instance is still the configured one.
    const response = await POST(
      new Request('http://10.0.0.5:3000/api/oauth/register', {
        method: 'POST',
        headers: { host: 'attacker.example', 'x-real-ip': '203.0.113.9' },
        body: JSON.stringify({
          redirect_uris: ['https://files.example.com/u/abc123'],
        }),
      })
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_redirect_uri')
  })

  it.each([
    'ms-msdt:/id%20PCWDiagnostic',
    'search-ms:query=report',
    'itms-services://?action=download-manifest',
    'intent://scan/',
    'tel:+15550100',
    'shell:startup',
    'shortcuts://run-shortcut?name=Export',
    'x-apple.systempreferences:com.apple.preference.security',
    'steam://run/440',
    'https://app.example/cb?code=mine',
  ])('refuses %s with invalid_redirect_uri', async (uri) => {
    const response = await register({ redirect_uris: [uri] })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_redirect_uri')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses a body over 8 KB, whether or not it states its length', async () => {
    const big = {
      redirect_uris: ['https://a.example/cb'],
      software_statement: 'x'.repeat(8 * 1024),
    }
    const stated = await register(big, {
      headers: { 'content-length': String(JSON.stringify(big).length) },
    })
    expect(stated.status).toBe(413)
    expect(await stated.json()).toEqual({
      error: 'invalid_client_metadata',
      error_description: 'A registration can be at most 8 KB.',
    })
    const text = JSON.stringify(big)
    const streamed = await POST(
      new Request(`${APP}/api/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text))
            controller.close()
          },
        }),
        // @ts-expect-error Node needs this to send a stream.
        duplex: 'half',
      })
    )
    expect(streamed.status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('takes a body just under 8 KB', async () => {
    const body = {
      redirect_uris: ['https://a.example/cb'],
      software_statement: '',
    }
    body.software_statement = 'x'.repeat(8 * 1024 - JSON.stringify(body).length)
    expect(JSON.stringify(body)).toHaveLength(8 * 1024)
    expect((await register(body)).status).toBe(201)
  })

  it('cuts a long client name to 80 characters and says so in the answer', async () => {
    const response = await register({
      client_name: `  ${'n'.repeat(200)}‮  `,
      redirect_uris: ['https://a.example/cb'],
    })
    expect(response.status).toBe(201)
    expect((await response.json()).client_name).toBe('n'.repeat(80))
  })

  describe('the rate limit', () => {
    const claude = {
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    }
    const chatgpt = {
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    }

    it('counts per client address and redirect host, for an hour', async () => {
      await register(claude)
      expect(mocks.limitCalls).toEqual([
        {
          key: 'oauth-register:203.0.113.9:claude.ai',
          limit: 10,
          seconds: 3600,
        },
        { key: 'oauth-register:203.0.113.9', limit: 100, seconds: 3600 },
      ])
    })

    it('refuses the eleventh registration in an hour with 429 and a retry time', async () => {
      for (let index = 0; index < 10; index++)
        expect((await register(claude)).status).toBe(201)
      const response = await register(claude)
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('1800')
      expect(await response.json()).toEqual({
        error: 'temporarily_unavailable',
        error_description:
          'Too many registrations from this address. Try again later.',
      })
      expect(mocks.create).toHaveBeenCalledTimes(10)
    })

    it('gives another redirect host from the same address its own allowance', async () => {
      for (let index = 0; index < 10; index++) await register(claude)
      expect((await register(claude)).status).toBe(429)
      expect((await register(chatgpt)).status).toBe(201)
    })

    it('gives another address its own allowance for the same host', async () => {
      for (let index = 0; index < 10; index++) await register(claude)
      expect((await register(claude)).status).toBe(429)
      expect((await register(claude, { address: '198.51.100.7' })).status).toBe(
        201
      )
    })

    it('counts every port of a local client as one host', async () => {
      for (let port = 50000; port < 50010; port++)
        expect(
          (
            await register({
              redirect_uris: [`http://localhost:${port}/callback`],
            })
          ).status
        ).toBe(201)
      expect(
        (await register({ redirect_uris: ['http://localhost:50011/callback'] }))
          .status
      ).toBe(429)
      // 127.0.0.1 is another host name, with its own count.
      expect(
        (await register({ redirect_uris: ['http://127.0.0.1:50011/callback'] }))
          .status
      ).toBe(201)
    })

    it('counts a private scheme under the scheme', async () => {
      await register({
        redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'],
      })
      expect(mocks.limitCalls[0].key).toBe('oauth-register:203.0.113.9:cursor:')
    })

    it('stops one address that names a new host every time at a hundred', async () => {
      for (let index = 0; index < 100; index++)
        expect(
          (
            await register({
              redirect_uris: [`https://host-${index}.example/cb`],
            })
          ).status
        ).toBe(201)
      expect(
        (await register({ redirect_uris: ['https://host-100.example/cb'] }))
          .status
      ).toBe(429)
      expect(mocks.create).toHaveBeenCalledTimes(100)
    })

    it('counts requests without an address together', async () => {
      await POST(
        new Request(`${APP}/api/oauth/register`, {
          method: 'POST',
          body: JSON.stringify(claude),
        })
      )
      expect(mocks.limitCalls[0].key).toBe('oauth-register:unknown:claude.ai')
    })
  })

  describe('registrations as real clients send them', () => {
    // Recorded shapes: the fields each client sends, with its own redirect
    // addresses. Ports of local clients change on every run.
    const payloads: Array<[string, Record<string, unknown>]> = [
      [
        'Claude',
        {
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'claudeai',
        },
      ],
      [
        'ChatGPT',
        {
          client_name: 'ChatGPT',
          redirect_uris: [
            'https://chatgpt.com/connector_platform_oauth_redirect',
          ],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          application_type: 'web',
        },
      ],
      [
        'Claude Code on localhost',
        {
          client_name: 'Claude Code (flare)',
          redirect_uris: ['http://localhost:61834/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      ],
      [
        'Claude Code on 127.0.0.1',
        {
          client_name: 'Claude Code (flare)',
          redirect_uris: ['http://127.0.0.1:61834/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      ],
      [
        'Cursor',
        {
          client_name: 'Cursor',
          redirect_uris: [
            'cursor://anysphere.cursor-mcp/oauth/callback',
            'http://localhost:8787/callback',
          ],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'native',
          client_uri: 'https://cursor.com',
        },
      ],
      [
        'VS Code',
        {
          client_name: 'Visual Studio Code',
          redirect_uris: [
            'http://127.0.0.1:33418/',
            'https://vscode.dev/redirect',
          ],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'native',
        },
      ],
      [
        'Codex',
        {
          client_name: 'Codex',
          redirect_uris: ['http://127.0.0.1:1455/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      ],
      [
        'Gemini CLI',
        {
          client_name: 'Gemini CLI MCP Client',
          redirect_uris: ['http://localhost:7777/oauth/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: '',
        },
      ],
    ]

    it.each(payloads)('registers %s', async (_client, payload) => {
      const response = await register(payload)
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({
        client_id: expect.stringMatching(/^flc_[A-Za-z0-9_-]{43}$/),
        client_name: payload.client_name,
        redirect_uris: payload.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      })
    })

    it.each(payloads)(
      'lets %s come back to each address it registered, on any local port',
      (_client, payload) => {
        const uris = payload.redirect_uris as string[]
        for (const uri of uris) {
          expect(redirectMatches(uris, uri)).toBe(true)
          const url = new URL(uri)
          if (url.protocol !== 'http:') continue
          url.port = '49152'
          expect(redirectMatches(uris, url.href)).toBe(true)
        }
        expect(redirectMatches(uris, 'https://evil.example/callback')).toBe(
          false
        )
      }
    )
  })

  describe('the audit log', () => {
    it('records a registration with the client as its target, and no actor', async () => {
      const response = await register({
        client_name: 'Example client',
        redirect_uris: ['https://a.example/cb'],
      })
      const { client_id } = await response.json()
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.register',
          category: 'authentication',
          outcome: 'success',
          status: 201,
          route: '/api/oauth/register',
          actorName: 'Anonymous',
          targetType: 'oauth_client',
          targetId: client_id,
          targetName: 'Example client',
        }),
      ])
    })

    it('records a refusal as a failure', async () => {
      await register({ redirect_uris: ['javascript:alert(1)'] })
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.register',
          category: 'authentication',
          outcome: 'failure',
          status: 400,
        }),
      ])
    })
  })

  it('answers server_error, without detail, when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.create.mockRejectedValue(
      new Error('connection to 10.0.0.3:5432 refused')
    )
    const { loggers } = await import('@/lib/logger')
    vi.spyOn(loggers.api, 'error').mockImplementation(() => loggers.api)
    const response = await register({ redirect_uris: ['https://a.example/cb'] })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'server_error' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    vi.restoreAllMocks()
  })
})
