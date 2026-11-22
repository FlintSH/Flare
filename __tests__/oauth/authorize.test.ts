import { GET, POST } from '@/app/api/oauth/authorize/route'
import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { DEFAULT_CONFIG } from '@/lib/config'
import { hashApiToken } from '@/lib/integrations/tokens'
import {
  type ConsentRequest,
  errorPage,
  readConsentRequest,
  signConsentRequest,
} from '@/lib/oauth/authorize'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  /** What `getServerSession` answers: the session as the cookie has it. */
  serverSession: vi.fn(),
  /** What `getAccessSession` answers: null for an account still to verify its email. */
  accessSession: vi.fn(),
  findClient: vi.fn(),
  countConnections: vi.fn(),
  markUsed: vi.fn(),
  createCode: vi.fn(),
  transaction: vi.fn(),
  /** The account's row as authentication reads it. */
  account: vi.fn(),
  /** The account's row lock, and the row as the transaction reads it under it. */
  lock: vi.fn(),
  lockedAccount: vi.fn(),
  settingsLock: vi.fn(),
  savedConfig: vi.fn(),
}))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.accessSession,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.serverSession }))
vi.mock('@/lib/database/prisma', () => {
  const tx = {
    // The settings lock, and the settings as saved, for an administration grant.
    $executeRaw: mocks.settingsLock,
    config: { findUnique: mocks.savedConfig },
    $queryRaw: mocks.lock,
    user: { findUnique: mocks.lockedAccount },
    oAuthClient: { updateMany: mocks.markUsed, findUnique: mocks.findClient },
    oAuthCode: { create: mocks.createCode },
  }
  return {
    prisma: {
      user: { findUnique: mocks.account },
      oAuthClient: { findUnique: mocks.findClient },
      agentConnection: { count: mocks.countConnections },
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => {
        mocks.transaction()
        return run(tx)
      },
    },
  }
})

const APP = 'https://files.example.com'
const SECRET = 'a-session-secret-for-tests-of-at-least-32-characters'
const CLIENT_ID = `flc_${'c'.repeat(43)}`
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const ALL_SCOPES = [
  'files:upload',
  'files:read',
  'files:content',
  'files:organize',
  'files:share',
  'files:delete',
  'urls:read',
  'urls:write',
  'account:write',
  'invites:write',
  'admin:read',
  'admin:users',
  'admin:content',
  'admin:settings',
]

const client = {
  id: CLIENT_ID,
  name: 'Claude',
  redirectUris: [REDIRECT, 'http://localhost:8787/callback'],
  createdAt: new Date('2026-11-21T12:00:00.000Z'),
  usedAt: null as Date | null,
}
const alex = {
  id: 'user-alex',
  name: 'Alex',
  email: 'alex@example.com',
  permissions: [...DEFAULT_PERMISSIONS, 'tokens.manage'] as string[],
  emailAccessRequired: false,
  /** The account's session version when this session was issued. */
  sessionVersion: 3,
}

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
  vi.stubEnv('NEXTAUTH_SECRET', SECRET)
  mocks.config.mockImplementation(async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp.enabled = enabled
    return config
  })
  mocks.findClient.mockImplementation(
    async ({ where }: { where: { id: string } }) =>
      where.id === CLIENT_ID ? client : null
  )
  mocks.serverSession.mockResolvedValue(null)
  mocks.accessSession.mockResolvedValue(null)
  mocks.countConnections.mockResolvedValue(0)
  mocks.markUsed.mockResolvedValue({ count: 1 })
  mocks.createCode.mockResolvedValue({})
  // The account is on the version its sessions were issued under.
  mocks.account.mockResolvedValue({ id: 'user-alex', sessionVersion: 3 })
  mocks.lock.mockResolvedValue([])
  mocks.lockedAccount.mockResolvedValue({ sessionVersion: 3 })
})
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const signedIn = (user: Partial<typeof alex> = {}) => {
  const session = { user: { ...alex, ...user } }
  mocks.serverSession.mockResolvedValue(session)
  mocks.accessSession.mockResolvedValue(
    session.user.emailAccessRequired ? null : session
  )
}

const valid = {
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'client-state-123',
}
type Query = Record<string, string | string[] | undefined>
function query(overrides: Query = {}): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries({ ...valid, ...overrides }))
    for (const one of Array.isArray(value) ? value : [value])
      if (one !== undefined) parameters.append(name, one)
  return parameters.toString()
}
const authorize = (
  overrides: Query = {},
  headers: Record<string, string> = {}
) =>
  GET(
    new Request(`${APP}/api/oauth/authorize?${query(overrides)}`, { headers })
  )

const location = (response: Response) => response.headers.get('location')!
const cookiesOf = (response: Response) => response.headers.getSetCookie()

async function expectErrorPage(response: Response, text: RegExp) {
  expect(response.status).toBe(400)
  expect(response.headers.has('location')).toBe(false)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-frame-options')).toBe('DENY')
  expect(cookiesOf(response)).toEqual([])
  expect(await response.text()).toMatch(text)
}

/** The consent blob a signed-in request was sent on with. */
function blobOf(response: Response): string {
  expect(response.status).toBe(302)
  const url = new URL(location(response), APP)
  expect(location(response).startsWith('/auth/connect?request=')).toBe(true)
  expect([...url.searchParams.keys()]).toEqual(['request'])
  return url.searchParams.get('request')!
}

describe('GET /api/oauth/authorize: the client and its redirect address', () => {
  it.each<[string, Query]>([
    ['an unknown client_id', { client_id: `flc_${'x'.repeat(43)}` }],
    ['no client_id', { client_id: undefined }],
    ['an empty client_id', { client_id: '' }],
    ['a client_id of another kind', { client_id: 'https://client.example/id' }],
    ['a client_id sent twice', { client_id: [CLIENT_ID, CLIENT_ID] }],
  ])('shows a page for %s, and redirects nowhere', async (_what, overrides) => {
    await expectErrorPage(await authorize(overrides), /is not registered/)
  })

  it.each<[string, Query]>([
    ['no redirect_uri', { redirect_uri: undefined }],
    ['an empty redirect_uri', { redirect_uri: '' }],
    ['another host', { redirect_uri: 'https://evil.example/callback' }],
    [
      'the registered host under another',
      { redirect_uri: 'https://claude.ai.evil.example/api/mcp/auth_callback' },
    ],
    [
      'an added query',
      { redirect_uri: `${REDIRECT}?next=https://evil.example` },
    ],
    ['an added path', { redirect_uri: `${REDIRECT}/../../evil` }],
    ['a user name', { redirect_uri: 'https://claude.ai@evil.example/cb' }],
    ['another scheme', { redirect_uri: 'javascript:alert(document.domain)' }],
    [
      'a data URL',
      { redirect_uri: 'data:text/html,<script>alert(1)</script>' },
    ],
    ['a path on Flare itself', { redirect_uri: '/dashboard' }],
    ['a protocol-relative address', { redirect_uri: '//evil.example/cb' }],
    [
      'a loopback address on another path',
      { redirect_uri: 'http://localhost:8787/other' },
    ],
    [
      '127.0.0.1 where localhost was registered',
      { redirect_uri: 'http://127.0.0.1:8787/callback' },
    ],
    ['a redirect_uri sent twice', { redirect_uri: [REDIRECT, REDIRECT] }],
    [
      'a registered address beside another',
      { redirect_uri: [REDIRECT, 'https://evil.example/cb'] },
    ],
  ])('shows a page for %s, and redirects nowhere', async (_what, overrides) => {
    await expectErrorPage(
      await authorize(overrides),
      /an address it did not register/
    )
  })

  it('shows the page even when everything else about the request is wrong too', async () => {
    const response = await authorize({
      redirect_uri: 'https://evil.example/callback',
      response_type: 'token',
      code_challenge: undefined,
      resource: 'https://other.example/',
    })
    await expectErrorPage(response, /an address it did not register/)
  })

  it('checks the client before the session: a signed-in person sees the page too', async () => {
    signedIn()
    await expectErrorPage(
      await authorize({ redirect_uri: 'https://evil.example/callback' }),
      /an address it did not register/
    )
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it('accepts a loopback redirect on any port, and records the port it was sent', async () => {
    signedIn()
    const consent = readConsentRequest(
      blobOf(
        await authorize({ redirect_uri: 'http://localhost:53124/callback' })
      )
    )
    expect(consent!.redirectUri).toBe('http://localhost:53124/callback')
  })
})

describe('GET /api/oauth/authorize: a redirect address on Flare itself', () => {
  /** A client whose registration holds these, as one made before a rule or an address changed. */
  async function withRegistered(uris: string[], run: () => Promise<void>) {
    client.redirectUris.push(...uris)
    try {
      await run()
    } finally {
      client.redirectUris.splice(-uris.length)
    }
  }
  const OWN = /send you back to this Flare instance itself/

  it.each([
    ['a short link on it', `${APP}/u/abc123`],
    ['a shared file on it', `${APP}/alex/report.pdf`],
    ['its sign-in page', `${APP}/auth/login`],
    ['its root', `${APP}/`],
    ['the default port written out', 'https://files.example.com:443/u/abc123'],
    ['its host in capitals', 'https://FILES.EXAMPLE.COM/u/abc123'],
  ])('shows a page for %s, whoever is signed in', async (_what, uri) => {
    await withRegistered([uri], async () => {
      for (const arrange of [() => {}, () => signedIn()]) {
        arrange()
        await expectErrorPage(await authorize({ redirect_uri: uri }), OWN)
      }
    })
  })

  it('still lets a client return to another port or scheme of the same host', async () => {
    const elsewhere = [
      'https://files.example.com:8443/callback',
      'https://app.files.example.com/callback',
    ]
    await withRegistered(elsewhere, async () => {
      for (const uri of elsewhere)
        expect(location(await authorize({ redirect_uri: uri }))).toBe(
          '/auth/login'
        )
    })
  })

  it('refuses the port this instance listens on to a local client, whose port is its own choice', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3199')
    const local = (uri: string) =>
      GET(
        new Request(
          `http://localhost:3199/api/oauth/authorize?${query({ redirect_uri: uri })}`
        )
      )
    // Registered as http://localhost:8787/callback, on any port.
    expect(location(await local('http://localhost:53124/callback'))).toBe(
      '/auth/login'
    )
    await expectErrorPage(await local('http://localhost:3199/callback'), OWN)
    // Every name of this computer reaches the same instance.
    await withRegistered(['http://127.0.0.1:1/callback'], async () => {
      await expectErrorPage(await local('http://127.0.0.1:3199/callback'), OWN)
      expect(location(await local('http://127.0.0.1:3198/callback'))).toBe(
        '/auth/login'
      )
    })
  })

  it('refuses an address a rule no longer allows, though it was registered', async () => {
    await withRegistered(
      ['ms-msdt:/id', 'https://app.example/cb?code=mine'],
      async () => {
        for (const uri of ['ms-msdt:/id', 'https://app.example/cb?code=mine'])
          await expectErrorPage(
            await authorize({ redirect_uri: uri }),
            /an address it did not register/
          )
      }
    )
  })
})

describe('the error page', () => {
  it('is static HTML that cannot be framed, cached or scripted', async () => {
    const response = errorPage('Something went wrong.')
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const html = await response.text()
    expect(html).toContain('<h1>This sign-in cannot continue</h1>')
    expect(html).toContain('<p>Something went wrong.</p>')
    expect(html).not.toMatch(/<script|<a |href=|src=|<form|<iframe/i)
  })

  it('escapes its text', async () => {
    const html = await errorPage(
      `<script>alert("x")</script> & <img src=x onerror='y'>`
    ).text()
    expect(html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=&#39;y&#39;&gt;'
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
  })

  it('never echoes what the request sent', async () => {
    const hostile = '"><script>alert(document.domain)</script>'
    for (const overrides of [
      { client_id: hostile },
      { redirect_uri: `https://evil.example/${hostile}` },
      { client_id: hostile, state: hostile, scope: hostile },
    ]) {
      const html = await (await authorize(overrides)).text()
      expect(html).not.toContain('alert(document.domain)')
      expect(html).not.toContain('evil.example')
    }
  })
})

/**
 * Everything that can be wrong with a request from a registered client that
 * names a registered redirect address, with what the page says about it.
 */
const TWICE = /sent part of its sign-in request twice/
const KIND = /a kind of sign-in Flare does not offer/
const PKCE = /left out a security check Flare requires \(PKCE with S256\)/
const TARGET = /access to something other than this Flare instance/
const LONG = /a sign-in request that is too long/
const REFUSALS: Array<[string, Query, RegExp]> = [
  ['a response_type other than code', { response_type: 'token' }, KIND],
  [
    'the implicit flow with an id_token',
    { response_type: 'id_token token' },
    KIND,
  ],
  ['no response_type', { response_type: undefined }, KIND],
  ['an empty response_type', { response_type: '' }, KIND],
  ['response_type sent twice', { response_type: ['code', 'code'] }, TWICE],
  ['no code_challenge', { code_challenge: undefined }, PKCE],
  ['an empty code_challenge', { code_challenge: '' }, PKCE],
  ['plain PKCE', { code_challenge_method: 'plain' }, PKCE],
  [
    'plain PKCE with the verifier as the challenge',
    { code_challenge: VERIFIER, code_challenge_method: 'plain' },
    PKCE,
  ],
  ['no code_challenge_method', { code_challenge_method: undefined }, PKCE],
  ['a method in another case', { code_challenge_method: 's256' }, PKCE],
  ['a challenge that is no SHA-256', { code_challenge: 'short' }, PKCE],
  ['a challenge with padding', { code_challenge: `${CHALLENGE}=` }, PKCE],
  ['two challenges', { code_challenge: [CHALLENGE, CHALLENGE] }, TWICE],
  ['two methods', { code_challenge_method: ['S256', 'plain'] }, TWICE],
  ['another resource', { resource: 'https://other.example/api/mcp' }, TARGET],
  ['the site root as the resource', { resource: APP }, TARGET],
  [
    'the MCP endpoint beside another resource',
    { resource: [`${APP}/api/mcp`, 'https://other.example/'] },
    TARGET,
  ],
  ['an empty resource', { resource: '' }, TARGET],
  ['scope sent twice', { scope: ['files:read', 'files:delete'] }, TWICE],
  ['state sent twice', { state: ['a', 'b'] }, TWICE],
  ['a state over 512 characters', { state: 's'.repeat(513) }, LONG],
]

describe('GET /api/oauth/authorize: every other problem is said on a page', () => {
  it.each(REFUSALS)(
    'shows a page for %s, and sends nothing to the client',
    async (_what, overrides, text) => {
      signedIn()
      const response = await authorize(overrides)
      await expectErrorPage(response, text)
      // Refused before anyone is asked who is signed in.
      expect(mocks.serverSession).not.toHaveBeenCalled()
    }
  )

  it('says to go back to the app, on every one of them', async () => {
    for (const [, overrides] of REFUSALS)
      expect(await (await authorize(overrides)).text()).toContain(
        'Go back to the app and connect again.'
      )
  })

  it('echoes nothing the request sent, not even its state', async () => {
    const hostile = '"><script>alert(document.domain)</script>'
    for (const [, overrides] of REFUSALS) {
      const html = await (
        await authorize({ state: hostile, scope: hostile, ...overrides })
      ).text()
      expect(html).not.toContain('alert(document.domain)')
      expect(html).not.toContain('client-state-123')
      expect(html).not.toContain(CLIENT_ID)
      expect(html).not.toContain('claude.ai')
    }
  })

  it('records each as a failed request with no redirect', async () => {
    await authorize({ response_type: 'token' })
    await auditSettled()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'oauth.authorize',
        category: 'authentication',
        outcome: 'failure',
        status: 400,
      }),
    ])
  })
})

describe('GET /api/oauth/authorize: the resource and the scopes', () => {
  beforeEach(() => signedIn())
  const consent = async (overrides: Query) =>
    readConsentRequest(blobOf(await authorize(overrides)))!

  it.each<[string, string | undefined]>([
    ['is missing', undefined],
    ['is the MCP endpoint', `${APP}/api/mcp`],
    ['has a trailing slash', `${APP}/api/mcp/`],
    ['spells the host in capitals', 'https://FILES.EXAMPLE.COM/api/mcp'],
  ])(
    'accepts a resource that %s, and records the MCP endpoint',
    async (_what, resource) => {
      expect((await consent({ resource })).resource).toBe(`${APP}/api/mcp`)
    }
  )

  it('takes the scopes the client asked for as the ceiling, in catalog order', async () => {
    expect(
      (await consent({ scope: 'urls:read files:read files:read' })).scopeCeiling
    ).toEqual(['files:read', 'urls:read'])
  })

  it('drops scopes Flare does not have, the marker for named tokens among them', async () => {
    expect(
      (
        await consent({
          scope: 'files:read mcp claudeai openid offline_access admin:all',
        })
      ).scopeCeiling
    ).toEqual(['files:read'])
  })

  it.each<[string, string | undefined]>([
    ['no scope', undefined],
    ['an empty scope', ''],
    ['only scopes Flare does not have', 'claudeai openid mcp'],
  ])('leaves the choice to the person for %s', async (_what, scope) => {
    expect((await consent({ scope })).scopeCeiling).toEqual(ALL_SCOPES)
  })

  it('never puts the marker in a ceiling', async () => {
    for (const scope of [undefined, 'mcp', `mcp ${ALL_SCOPES.join(' ')}`])
      expect((await consent({ scope })).scopeCeiling).not.toContain('mcp')
  })
})

describe('GET /api/oauth/authorize: oversized requests', () => {
  it('refuses a query over 4 KB with a page, before reading anything in it', async () => {
    const response = await authorize({ state: 's'.repeat(4096) })
    await expectErrorPage(response, /too long/)
    expect(mocks.findClient).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it('takes a query of exactly 4 KB as far as its own checks', async () => {
    const padding = 4096 - query({ ignored: '' }).length
    const response = await authorize({ ignored: 'x'.repeat(padding) })
    expect(response.status).toBe(302)
    expect(location(response)).toBe('/auth/login')
  })

  it('refuses a state over 512 characters with a page, and stores nothing', async () => {
    const response = await authorize({ state: 's'.repeat(513) })
    await expectErrorPage(response, /too long/)
    expect(mocks.serverSession).not.toHaveBeenCalled()
  })

  it('takes a state of exactly 512 characters', async () => {
    const response = await authorize({ state: 's'.repeat(512) })
    expect(location(response)).toBe('/auth/login')
  })

  it('refuses a request that would not fit the cookie with a page, instead of storing part of it', async () => {
    // Under 4 KB as sent, but each of these characters takes three in a cookie.
    const url = `${APP}/api/oauth/authorize?${query()}&scope=${'~'.repeat(3000)}`
    expect(new URL(url).search.length).toBeLessThan(4096)
    for (const arrange of [
      () => {},
      () => signedIn({ emailAccessRequired: true }),
    ]) {
      arrange()
      await expectErrorPage(await GET(new Request(url)), /too long/)
    }
  })

  it('does not need the cookie, or its limit, for someone already signed in', async () => {
    signedIn()
    const url = `${APP}/api/oauth/authorize?${query()}&scope=${'~'.repeat(3000)}`
    expect(location(await GET(new Request(url)))).toMatch(
      /^\/auth\/connect\?request=/
    )
  })
})

describe('GET /api/oauth/authorize: signed out', () => {
  it('stores the request in two cookies and goes to the login page', async () => {
    const response = await authorize({
      scope: 'files:read',
      resource: `${APP}/api/mcp`,
    })
    expect(response.status).toBe(302)
    expect(location(response)).toBe('/auth/login')
    const [request, pending] = cookiesOf(response)
    expect(cookiesOf(response)).toHaveLength(2)
    expect(request).toMatch(
      /^flare_oauth_request=[A-Za-z0-9*\-._+%=&]+; Path=\/; Max-Age=600; SameSite=Lax; Secure; HttpOnly$/
    )
    // The marker says only that something waits, and scripts may read it.
    expect(pending).toBe(
      'flare_oauth_pending=1; Path=/; Max-Age=600; SameSite=Lax; Secure'
    )
    const stored = new URLSearchParams(
      request.split(';')[0].split('=').slice(1).join('=')
    )
    expect(Object.fromEntries(stored)).toEqual({
      ...valid,
      scope: 'files:read',
      resource: `${APP}/api/mcp`,
    })
  })

  it('keeps only the parameters it reads', async () => {
    const response = await authorize({
      prompt: 'consent',
      login_hint: 'someone@example.com',
      redirect_to: 'https://evil.example',
    })
    const stored = new URLSearchParams(
      cookiesOf(response)[0].split(';')[0].split('=').slice(1).join('=')
    )
    expect([...stored.keys()].sort()).toEqual(Object.keys(valid).sort())
  })

  it('leaves Secure off only when the instance is served over http', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://flare.lan:3000')
    const response = await GET(
      new Request(`http://flare.lan:3000/api/oauth/authorize?${query()}`)
    )
    for (const cookie of cookiesOf(response))
      expect(cookie).not.toMatch(/Secure/)
    expect(cookiesOf(response)[0]).toMatch(/HttpOnly$/)
  })

  it('stays on the address the browser used: the redirect is a path', async () => {
    const response = await GET(
      new Request(`http://10.0.0.5:3000/api/oauth/authorize?${query()}`, {
        headers: { host: 'evil.example' },
      })
    )
    expect(location(response)).toBe('/auth/login')
  })

  it('treats a session that no longer holds as signed out', async () => {
    mocks.serverSession.mockResolvedValue({})
    expect(location(await authorize())).toBe('/auth/login')
  })
})

describe('GET /api/oauth/authorize: an account that must verify its email', () => {
  it('is sent to the confirmation page with the cookies kept, not to consent', async () => {
    signedIn({ emailAccessRequired: true })
    const response = await authorize()
    expect(response.status).toBe(302)
    expect(location(response)).toBe('/auth/verify-email')
    expect(cookiesOf(response).map((cookie) => cookie.split('=')[0])).toEqual([
      'flare_oauth_request',
      'flare_oauth_pending',
    ])
    expect(cookiesOf(response)[0]).toMatch(/Max-Age=600/)
  })

  it('goes to consent once the address is confirmed', async () => {
    signedIn({ emailAccessRequired: false })
    expect(location(await authorize())).toMatch(/^\/auth\/connect\?request=/)
  })
})

describe('GET /api/oauth/authorize: signed in', () => {
  beforeEach(() => signedIn())

  it('goes to the consent screen with a request only Flare could have signed', async () => {
    const before = Math.floor(Date.now() / 1000)
    const response = await authorize({ scope: 'files:read urls:read' })
    const blob = blobOf(response)
    const consent = readConsentRequest(blob)
    expect(consent).toEqual({
      clientId: CLIENT_ID,
      clientName: 'Claude',
      redirectUri: REDIRECT,
      codeChallenge: CHALLENGE,
      state: 'client-state-123',
      resource: `${APP}/api/mcp`,
      scopeCeiling: ['files:read', 'urls:read'],
      userId: 'user-alex',
      exp: expect.any(Number),
    })
    // Ten minutes, in seconds since the epoch.
    expect(consent!.exp).toBeGreaterThanOrEqual(before + 600)
    expect(consent!.exp).toBeLessThanOrEqual(before + 602)
    expect(cookiesOf(response)).toEqual([])
  })

  it('writes the request as base64url JSON, a dot, and an HMAC under a key of its own', async () => {
    const blob = blobOf(await authorize())
    const [payload, signature, ...rest] = blob.split('.')
    expect(rest).toEqual([])
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual(
      readConsentRequest(blob)
    )
    const key = Buffer.from(
      hkdfSync('sha256', SECRET, 'flare-oauth-v1', 'consent', 32)
    )
    expect(signature).toBe(
      createHmac('sha256', key).update(payload).digest('base64url')
    )
    // Not the session secret itself.
    expect(signature).not.toBe(
      createHmac('sha256', SECRET).update(payload).digest('base64url')
    )
  })

  it('records a null state when the client sent none', async () => {
    const consent = readConsentRequest(
      blobOf(await authorize({ state: undefined }))
    )
    expect(consent!.state).toBeNull()
  })

  it('clears cookies an earlier attempt left, so it is not resumed later', async () => {
    const response = await authorize(
      {},
      { cookie: 'flare_oauth_request=client_id%3Dold; flare_oauth_pending=1' }
    )
    expect(location(response)).toMatch(/^\/auth\/connect\?request=/)
    expect(cookiesOf(response)).toEqual([
      'flare_oauth_request=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly',
      'flare_oauth_pending=; Path=/; Max-Age=0; SameSite=Lax; Secure',
    ])
  })

  it('sends an account without tokens.manage to consent too, which explains', async () => {
    signedIn({ permissions: ['files.read'] })
    expect(location(await authorize())).toMatch(/^\/auth\/connect\?request=/)
  })

  it('sends no CORS headers, whoever asks', async () => {
    const response = await authorize({}, { origin: 'https://claude.ai' })
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('records the request with the client as its target', async () => {
    await authorize()
    await auditSettled()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'oauth.authorize',
        category: 'authentication',
        outcome: 'success',
        status: 302,
        route: '/api/oauth/authorize',
        targetType: 'oauth_client',
        targetId: CLIENT_ID,
        targetName: 'Claude',
      }),
    ])
    // The audit log never holds the consent request.
    expect(JSON.stringify(events)).not.toContain(CHALLENGE)
  })
})

describe('GET /api/oauth/authorize never sends a browser off Flare', () => {
  /** Who is at the browser when the request arrives. */
  const VISITORS: Array<[string, () => void]> = [
    ['signed out', () => {}],
    ['signed in', () => signedIn()],
    [
      'with an unverified address',
      () => signedIn({ emailAccessRequired: true }),
    ],
    ['signed in without tokens.manage', () => signedIn({ permissions: [] })],
  ]
  /** The only places a response of this endpoint may point at. */
  const OWN = /^\/auth\/(login|verify-email|connect\?request=[A-Za-z0-9_.-]+)$/

  /** Every way a request can fail before the consent screen. */
  const FAILURES: Array<[string, () => Promise<Response>]> = [
    ...[
      ['an unknown client', { client_id: `flc_${'x'.repeat(43)}` }],
      ['no client', { client_id: undefined }],
      ['a client sent twice', { client_id: [CLIENT_ID, CLIENT_ID] }],
      ['no redirect address', { redirect_uri: undefined }],
      [
        'an unregistered redirect address',
        { redirect_uri: 'https://evil.example/callback' },
      ],
      [
        'a redirect address sent twice',
        { redirect_uri: [REDIRECT, 'https://evil.example/callback'] },
      ],
      [
        'a script as the redirect address',
        { redirect_uri: 'javascript:alert(1)' },
      ],
      ...REFUSALS,
    ].map(
      ([what, overrides]) =>
        [what as string, () => authorize(overrides as Query)] as [
          string,
          () => Promise<Response>,
        ]
    ),
    ['a query over 4 KB', () => authorize({ state: 's'.repeat(4096) })],
    [
      'a request too long for the cookie',
      () =>
        GET(
          new Request(
            `${APP}/api/oauth/authorize?${query()}&scope=${'~'.repeat(3000)}`
          )
        ),
    ],
  ]

  it.each(VISITORS)(
    'walks every failure %s: a page each time, and no Location at all',
    async (_who, arrange) => {
      expect(FAILURES.length).toBeGreaterThan(30)
      for (const [what, send] of FAILURES) {
        vi.clearAllMocks()
        mocks.findClient.mockImplementation(
          async ({ where }: { where: { id: string } }) =>
            where.id === CLIENT_ID ? client : null
        )
        arrange()
        const response = await send()
        // The one failure a signed-in person does not meet: they need no cookie.
        const fits =
          what === 'a request too long for the cookie' &&
          response.status === 302
        if (fits) {
          expect(response.headers.get('location')).toMatch(OWN)
          continue
        }
        expect(response.status, what).toBe(400)
        expect(response.headers.has('location'), what).toBe(false)
        expect(response.headers.getSetCookie(), what).toEqual([])
        expect(response.headers.get('content-type'), what).toBe(
          'text/html; charset=utf-8'
        )
        const html = await response.text()
        expect(html, what).not.toMatch(/<a |href=|http-equiv|<script|<form/i)
        expect(html, what).not.toContain('evil.example')
      }
    }
  )

  it.each(VISITORS)(
    'sends a valid request %s to one of its own pages, by path',
    async (_who, arrange) => {
      arrange()
      for (const overrides of [
        {},
        { redirect_uri: 'http://localhost:61000/callback' },
        { scope: 'files:read', resource: `${APP}/api/mcp/` },
      ]) {
        const response = await authorize(overrides)
        expect(response.status).toBe(302)
        expect(location(response)).toMatch(OWN)
      }
    }
  )

  const hostile = [
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example',
    'javascript:alert(1)',
    'https://files.example.com@evil.example/',
    '\r\nLocation: https://evil.example/',
  ]
  const fields = [
    'state',
    'scope',
    'resource',
    'code_challenge',
    'response_type',
    'code_challenge_method',
    'client_id',
    'redirect_uri',
    'next',
    'callbackUrl',
    'redirect',
    'returnTo',
    'error',
    'iss',
  ]

  it.each(VISITORS)(
    'answers %s with a page or one of its own paths, whatever any parameter holds',
    async (_who, arrange) => {
      arrange()
      for (const value of hostile)
        for (const field of fields) {
          const response = await authorize({ [field]: value })
          const target = response.headers.get('location')
          if (target === null) expect(response.status).toBe(400)
          else {
            expect(response.status).toBe(302)
            expect(target, `${field}=${value}`).toMatch(OWN)
          }
        }
    }
  )

  it('reaches a client only through the consent decision of a signed-in person', async () => {
    // Every refusal and every valid request above ended on Flare. The two
    // answers that name the client's address come from POST, tested below.
    signedIn()
    for (const overrides of [{}, { response_type: 'token' }]) {
      const response = await authorize(overrides)
      expect(response.headers.get('location') ?? '').not.toContain('claude.ai')
    }
  })
})

describe('the consent request', () => {
  const request = {
    client,
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    state: 'state',
    resource: `${APP}/api/mcp`,
    scopeCeiling: ['files:read'],
  }
  const resign = (
    change: (payload: ConsentRequest) => unknown,
    secret = SECRET
  ) => {
    const blob = signConsentRequest(request, 'user-alex')
    const value = JSON.parse(
      Buffer.from(blob.split('.')[0], 'base64url').toString()
    ) as ConsentRequest
    const payload = Buffer.from(JSON.stringify(change(value))).toString(
      'base64url'
    )
    const key = Buffer.from(
      hkdfSync('sha256', secret, 'flare-oauth-v1', 'consent', 32)
    )
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
  }

  it('reads back what was signed', () => {
    const consent = readConsentRequest(signConsentRequest(request, 'user-alex'))
    expect(consent).toMatchObject({
      clientId: CLIENT_ID,
      userId: 'user-alex',
      scopeCeiling: ['files:read'],
    })
  })

  it('is refused once any part of it changes', () => {
    const blob = signConsentRequest(request, 'user-alex')
    const [payload, signature] = blob.split('.')
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const forged = (change: Row) =>
      `${Buffer.from(JSON.stringify({ ...value, ...change })).toString('base64url')}.${signature}`
    for (const tampered of [
      forged({ redirectUri: 'https://evil.example/callback' }),
      forged({ userId: 'user-sam' }),
      forged({ scopeCeiling: ALL_SCOPES }),
      forged({ exp: value.exp + 3600 }),
      forged({ clientId: `flc_${'x'.repeat(43)}` }),
      forged({ codeChallenge: 'x'.repeat(43) }),
      // One character of the payload, and of the signature.
      `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`,
      `${payload}.${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`,
      `${payload}.${signature.slice(0, 10)}`,
      `${payload}.`,
      `${payload}`,
      `.${signature}`,
      `${payload}.${signature}.${signature}`,
      `${payload}.${Buffer.from('not the right length').toString('base64url')}`,
      '',
      '.',
      'null',
    ])
      expect(readConsentRequest(tampered), tampered.slice(0, 40)).toBeNull()
  })

  it('is refused when signed with another secret, or the session secret itself', () => {
    expect(
      readConsentRequest(resign((payload) => payload, 'another-secret'))
    ).toBeNull()
    const [payload] = signConsentRequest(request, 'user-alex').split('.')
    const direct = createHmac('sha256', SECRET)
      .update(payload)
      .digest('base64url')
    expect(readConsentRequest(`${payload}.${direct}`)).toBeNull()
  })

  it('is accepted until it expires, and not a second longer', () => {
    const now = Date.parse('2026-11-21T12:00:00.000Z')
    const blob = signConsentRequest(request, 'user-alex', now)
    expect(readConsentRequest(blob, now + 599_000)).not.toBeNull()
    expect(readConsentRequest(blob, now + 600_000)).toBeNull()
    expect(readConsentRequest(blob, now + 86_400_000)).toBeNull()
  })

  it('is refused when well signed but not shaped like a request', () => {
    for (const change of [
      () => null,
      () => [],
      () => 'text',
      (payload: ConsentRequest) => ({ ...payload, exp: 'never' }),
      (payload: ConsentRequest) => ({ ...payload, scopeCeiling: 'files:read' }),
      (payload: ConsentRequest) => ({ ...payload, userId: undefined }),
    ])
      expect(readConsentRequest(resign(change))).toBeNull()
  })

  it('cannot be signed without a session secret', () => {
    vi.stubEnv('NEXTAUTH_SECRET', '')
    expect(() => signConsentRequest(request, 'user-alex')).toThrow(
      /NEXTAUTH_SECRET/
    )
  })
})

describe('POST /api/oauth/authorize: the decision', () => {
  const blob = (
    overrides: Partial<Parameters<typeof signConsentRequest>[0]> = {},
    userId = 'user-alex',
    now = Date.now()
  ) =>
    signConsentRequest(
      {
        client,
        redirectUri: REDIRECT,
        codeChallenge: CHALLENGE,
        state: 'client-state-123',
        resource: `${APP}/api/mcp`,
        scopeCeiling: ALL_SCOPES,
        ...overrides,
      },
      userId,
      now
    )
  const decide = (body: unknown, headers: Record<string, string> = {}) =>
    POST(
      new Request(`${APP}/api/oauth/authorize`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: APP,
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      })
    )
  const approve = (scopes: string[], request = blob()) =>
    decide({ request, decision: 'approve', scopes })
  const refusal = async (response: Response, status = 400) => {
    expect(response.status).toBe(status)
    expect(mocks.createCode).not.toHaveBeenCalled()
    return (await response.json()).error as string
  }

  beforeEach(() => signedIn())

  describe('who may answer', () => {
    it('needs a session', async () => {
      mocks.accessSession.mockResolvedValue(null)
      expect(await refusal(await approve(['files:read']), 401)).toBe(
        'Authentication required'
      )
    })

    it('refuses an account that must still verify its email', async () => {
      signedIn({ emailAccessRequired: true })
      expect((await approve(['files:read'])).status).toBe(401)
      expect(mocks.createCode).not.toHaveBeenCalled()
    })

    it.each([
      ['another origin', { origin: 'https://evil.example' }],
      ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
      [
        'another origin that claims to be same-site',
        { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
      ],
      ['the null origin of a sandboxed frame', { origin: 'null' }],
    ])('refuses a post from %s', async (_what, headers) => {
      const response = await decide(
        { request: blob(), decision: 'approve', scopes: ['files:read'] },
        headers
      )
      expect(await refusal(response, 403)).toBe(
        'Cross-origin requests are not allowed.'
      )
    })

    it.each([
      ['a form post', 'application/x-www-form-urlencoded'],
      ['plain text', 'text/plain'],
      ['a multipart form', 'multipart/form-data; boundary=x'],
    ])(
      'refuses %s, which another site could send without a preflight',
      async (_what, type) => {
        const response = await decide(
          JSON.stringify({
            request: blob(),
            decision: 'approve',
            scopes: ['files:read'],
          }),
          { 'content-type': type }
        )
        expect(await refusal(response, 415)).toBe('Use application/json.')
      }
    )

    it('refuses a session issued before the account was signed out everywhere', async () => {
      // The account has moved on since this session was issued.
      mocks.account.mockResolvedValue({ id: 'user-alex', sessionVersion: 4 })
      expect(await refusal(await approve(['files:read']), 401)).toBe(
        'Sign in again to continue.'
      )
      expect(mocks.transaction).not.toHaveBeenCalled()
    })

    it('refuses a session whose account is gone', async () => {
      mocks.account.mockResolvedValue(null)
      expect((await approve(['files:read'])).status).toBe(401)
      expect(mocks.createCode).not.toHaveBeenCalled()
    })

    it('sends no CORS headers', async () => {
      const response = await approve(['files:read'])
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
      expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('needs tokens.manage to approve', async () => {
      signedIn({ permissions: ['files.read', 'files.upload'] })
      expect(await refusal(await approve(['files:read']), 403)).toBe(
        'Your role does not allow connecting agents.'
      )
    })

    it('lets an account without tokens.manage cancel', async () => {
      signedIn({ permissions: [] })
      const response = await decide({ request: blob(), decision: 'deny' })
      expect(response.status).toBe(200)
      expect(
        new URL((await response.json()).redirect).searchParams.get('error')
      ).toBe('access_denied')
    })
  })

  describe('the request it answers', () => {
    it('refuses a tampered request', async () => {
      const [payload, signature] = blob().split('.')
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString())
      const forged = `${Buffer.from(
        JSON.stringify({ ...value, redirectUri: 'https://evil.example/cb' })
      ).toString('base64url')}.${signature}`
      expect(await refusal(await approve(['files:read'], forged))).toMatch(
        /has expired/
      )
    })

    it('refuses an expired request', async () => {
      const old = blob({}, 'user-alex', Date.now() - 601_000)
      expect(await refusal(await approve(['files:read'], old))).toMatch(
        /has expired/
      )
    })

    it('refuses a request made for another account, to approve or to deny', async () => {
      const theirs = blob({}, 'user-sam')
      expect(await refusal(await approve(['files:read'], theirs))).toMatch(
        /another Flare account/
      )
      const denied = await decide({ request: theirs, decision: 'deny' })
      expect(denied.status).toBe(400)
      expect(await denied.json()).not.toHaveProperty('redirect')
    })

    it.each([
      [{ decision: 'approve', scopes: ['files:read'] }],
      [{ request: '', decision: 'approve', scopes: ['files:read'] }],
      [{ request: 42, decision: 'approve', scopes: [] }],
      [{ request: 'x'.repeat(9000), decision: 'approve', scopes: [] }],
      [{ request: 'blob', decision: 'maybe', scopes: [] }],
      [{ request: 'blob', scopes: [] }],
      [{ request: 'blob', decision: 'approve', scopes: 'files:read' }],
      [{ request: 'blob', decision: 'approve', scopes: [42] }],
      [null],
      [[]],
    ])('refuses the body %j', async (body) => {
      const response = await decide(body)
      expect(response.status).toBe(400)
      expect(mocks.createCode).not.toHaveBeenCalled()
    })

    it('refuses a body that is not JSON, and one over 16 KB', async () => {
      expect((await decide('{not json')).status).toBe(400)
      expect(
        (
          await decide({
            request: blob(),
            decision: 'approve',
            scopes: [],
            padding: 'x'.repeat(17_000),
          })
        ).status
      ).toBe(413)
    })
  })

  describe('the scopes', () => {
    it('refuses a scope outside what the client asked for', async () => {
      const narrow = blob({ scopeCeiling: ['files:read', 'urls:read'] })
      expect(
        await refusal(await approve(['files:read', 'files:delete'], narrow))
      ).toBe(
        'This sign-in cannot grant "Delete files". Remove it and try again.'
      )
    })

    it.each([[['mcp']], [['mcp', 'files:read']], [['files:read', 'mcp']]])(
      'never grants the marker: %j',
      async (scopes) => {
        expect(await refusal(await approve(scopes))).toBe(
          'This sign-in cannot grant "Agent access". Remove it and try again.'
        )
      }
    )

    it('refuses the marker even if a ceiling were to name it', async () => {
      const withMarker = blob({ scopeCeiling: ['files:read', 'mcp'] })
      expect(await refusal(await approve(['mcp'], withMarker))).toMatch(
        /cannot grant "Agent access"/
      )
    })

    it('refuses a scope that does not exist', async () => {
      expect(
        await refusal(await approve(['files:read', 'admin:everything']))
      ).toBe(
        'This sign-in cannot grant "admin:everything". Remove it and try again.'
      )
    })

    it("refuses a scope the account's role cannot use", async () => {
      // The default role reads and uploads, and deletes nothing.
      signedIn({ permissions: ['tokens.manage', 'files.read', 'files.upload'] })
      expect(
        await refusal(
          await approve(['files:read', 'files:delete', 'urls:write'])
        )
      ).toBe(
        'Your role does not allow "Delete files", "Manage short links". Remove them and try again.'
      )
    })

    it('grants changing account settings to a role that can use it, and to no other', async () => {
      // Tokens alone are no account setting an agent can change.
      signedIn({ permissions: ['tokens.manage', 'files.read'] })
      expect(
        await refusal(await approve(['files:read', 'account:write']))
      ).toBe(
        'Your role does not allow "Change account settings". Remove it and try again.'
      )
      // Either of the things the scope is for is enough.
      for (const permission of ['profile.update', 'uploadProfiles.manage']) {
        signedIn({ permissions: ['tokens.manage', 'files.read', permission] })
        mocks.createCode.mockClear()
        const response = await approve(['account:write', 'files:read'])
        expect(response.status, permission).toBe(200)
        expect(mocks.createCode.mock.calls[0][0].data.scopes).toEqual([
          'files:read',
          'account:write',
        ])
      }
    })

    describe('administration scopes', () => {
      const administration = (on: boolean, saved = on) => {
        const config = (value: boolean) => {
          const config = structuredClone(DEFAULT_CONFIG)
          config.settings.general.mcp.enabled = enabled
          config.settings.general.mcp.administration = value
          return config
        }
        mocks.config.mockImplementation(async () => config(on))
        // What the transaction reads under the settings lock.
        mocks.savedConfig.mockResolvedValue({ value: config(saved) })
      }

      it('refuses them while administration through MCP is off, even to an administrator', async () => {
        signedIn({ permissions: ['administrator'] })
        administration(false)
        expect(
          await refusal(
            await approve(['files:read', 'admin:read', 'admin:users'])
          )
        ).toBe(
          'Administration through MCP is turned off on this instance, so agents cannot have "View administration", "Manage users and roles". Remove them and try again.'
        )
      })

      it('grants them while it is on, to a role that can use them', async () => {
        signedIn({
          permissions: ['tokens.manage', 'files.read', 'content.read'],
        })
        administration(true)
        const response = await approve(['files:read', 'admin:content'])
        expect(response.status).toBe(200)
        expect(mocks.createCode.mock.calls[0][0].data.scopes).toEqual([
          'files:read',
          'admin:content',
        ])
      })

      it('reads the switch again under the settings lock, first, and refuses when it went off meanwhile', async () => {
        signedIn({
          permissions: ['tokens.manage', 'files.read', 'content.read'],
        })
        administration(true, false)
        expect(
          await refusal(await approve(['files:read', 'admin:content']))
        ).toBe(
          'Administration through MCP is turned off on this instance, so agents cannot have "Moderate content". Remove it and try again.'
        )
        // The settings lock before the account's row.
        expect(mocks.settingsLock).toHaveBeenCalledOnce()
        expect(mocks.lock).not.toHaveBeenCalled()
        administration(true)
        mocks.settingsLock.mockClear()
        expect((await approve(['files:read', 'admin:content'])).status).toBe(
          200
        )
        expect(mocks.settingsLock.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.lock.mock.invocationCallOrder[0]
        )
      })

      it('takes no settings lock for a grant without one', async () => {
        expect((await approve(['files:read'])).status).toBe(200)
        expect(mocks.settingsLock).not.toHaveBeenCalled()
        expect(mocks.savedConfig).not.toHaveBeenCalled()
      })

      it("refuses one the account's role cannot use while it is on", async () => {
        signedIn({ permissions: ['tokens.manage', 'files.read', 'users.read'] })
        administration(true)
        expect(
          await refusal(await approve(['admin:read', 'admin:settings']))
        ).toBe(
          'Your role does not allow "Change instance settings". Remove it and try again.'
        )
      })

      it('grants invites without the switch: they are not administration', async () => {
        signedIn({ permissions: ['tokens.manage', 'invites.create'] })
        administration(false)
        expect((await approve(['invites:write'])).status).toBe(200)
      })
    })

    it('refuses an approval that grants nothing', async () => {
      expect(await refusal(await approve([]))).toBe(
        'Choose at least one permission.'
      )
    })

    it('stores the granted scopes once each, in catalog order', async () => {
      const response = await approve([
        'urls:read',
        'files:read',
        'files:read',
        'files:upload',
      ])
      expect(response.status).toBe(200)
      expect(mocks.createCode.mock.calls[0][0].data.scopes).toEqual([
        'files:upload',
        'files:read',
        'urls:read',
      ])
    })
  })

  describe('the connection limit', () => {
    it('refuses another agent once the account has fifty', async () => {
      mocks.countConnections.mockResolvedValue(50)
      expect(await refusal(await approve(['files:read']))).toBe(
        'This account already has 50 connected agents. Disconnect one you no longer use, then connect again.'
      )
    })

    it('allows the fiftieth, and counts only connections that still work', async () => {
      mocks.countConnections.mockResolvedValue(49)
      expect((await approve(['files:read'])).status).toBe(200)
      expect(mocks.countConnections).toHaveBeenCalledWith({
        where: {
          userId: 'user-alex',
          revokedAt: null,
          tokens: { some: { refreshExpiresAt: { gt: expect.any(Date) } } },
          // Nor one past the 30 days of an administration grant.
          NOT: {
            scopes: {
              hasSome: [
                'admin:read',
                'admin:users',
                'admin:content',
                'admin:settings',
              ],
            },
            createdAt: { lte: expect.any(Date) },
          },
        },
      })
    })

    it('still lets the person decline at the limit', async () => {
      mocks.countConnections.mockResolvedValue(50)
      expect((await decide({ request: blob(), decision: 'deny' })).status).toBe(
        200
      )
    })
  })

  describe('declining', () => {
    it('answers the redirect with access_denied, state and iss, and creates nothing', async () => {
      const response = await decide({
        request: blob(),
        decision: 'deny',
        scopes: ['files:read'],
      })
      expect(response.status).toBe(200)
      const { redirect } = await response.json()
      const url = new URL(redirect)
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT)
      expect(Object.fromEntries(url.searchParams)).toEqual({
        error: 'access_denied',
        error_description: expect.any(String),
        state: 'client-state-123',
        iss: APP,
      })
      expect(mocks.createCode).not.toHaveBeenCalled()
      expect(mocks.markUsed).not.toHaveBeenCalled()
    })
  })

  describe('approving', () => {
    it('creates exactly one code, bound to everything the request named', async () => {
      const before = Date.now()
      const response = await approve(['files:read', 'urls:read'])
      expect(response.status).toBe(200)
      const { redirect } = await response.json()
      const url = new URL(redirect)
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT)
      expect([...url.searchParams.keys()]).toEqual(['code', 'state', 'iss'])
      expect(url.searchParams.get('state')).toBe('client-state-123')
      expect(url.searchParams.get('iss')).toBe(APP)
      const code = url.searchParams.get('code')!
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)

      expect(mocks.transaction).toHaveBeenCalledTimes(1)
      expect(mocks.createCode).toHaveBeenCalledTimes(1)
      const { data } = mocks.createCode.mock.calls[0][0]
      expect(data).toEqual({
        // The digest, never the code.
        hash: hashApiToken(code),
        clientId: CLIENT_ID,
        userId: 'user-alex',
        redirectUri: REDIRECT,
        codeChallenge: CHALLENGE,
        resource: `${APP}/api/mcp`,
        scopes: ['files:read', 'urls:read'],
        // The session version the approval was made under.
        sessionVersion: 3,
        expiresAt: expect.any(Date),
      })
      expect(JSON.stringify(data)).not.toContain(code)
      // Sixty seconds.
      expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(60_000)
      expect(data.expiresAt.getTime() - before).toBeLessThan(62_000)
    })

    it("creates the code under the account's row lock, for the session version that approved", async () => {
      await approve(['files:read'])
      const [statement, id] = mocks.lock.mock.calls[0]
      expect(statement.join('?')).toBe(
        'SELECT "id" FROM "User" WHERE "id" = ? FOR UPDATE'
      )
      expect(id).toBe('user-alex')
      const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
        mock.mock.invocationCallOrder[0]
      // The lock, then the account as it is now, then anything written.
      expect(order(mocks.lock)).toBeLessThan(order(mocks.lockedAccount))
      expect(order(mocks.lockedAccount)).toBeLessThan(order(mocks.markUsed))
      expect(order(mocks.markUsed)).toBeLessThan(order(mocks.createCode))
      expect(mocks.lockedAccount).toHaveBeenCalledWith({
        where: { id: 'user-alex' },
        select: { sessionVersion: true },
      })
      expect(mocks.createCode.mock.calls[0][0].data.sessionVersion).toBe(3)
    })

    it.each([
      [
        'was signed out everywhere after the answer was authenticated',
        { sessionVersion: 4 },
      ],
      ['was deleted meanwhile', null],
    ])('creates nothing when the account %s', async (_what, row) => {
      // Authentication saw version 3. By the time the decision holds the
      // account's lock, a sign-out everywhere has committed.
      mocks.lockedAccount.mockResolvedValue(row)
      expect(await refusal(await approve(['files:read']), 401)).toBe(
        'Sign in again to continue.'
      )
      expect(mocks.lock).toHaveBeenCalledOnce()
      expect(mocks.markUsed).not.toHaveBeenCalled()
      expect(mocks.createCode).not.toHaveBeenCalled()
    })

    it('takes no lock to decline: nothing is created', async () => {
      const response = await decide({ request: blob(), decision: 'deny' })
      expect(response.status).toBe(200)
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.lock).not.toHaveBeenCalled()
    })

    it('gives every approval its own code', async () => {
      const codes = new Set<string>()
      for (let index = 0; index < 3; index++) {
        const { redirect } = await (await approve(['files:read'])).json()
        codes.add(new URL(redirect).searchParams.get('code')!)
      }
      expect(codes.size).toBe(3)
    })

    it('marks the client as used, in the transaction that creates the code', async () => {
      await approve(['files:read'])
      expect(mocks.markUsed).toHaveBeenCalledWith({
        where: { id: CLIENT_ID, usedAt: null },
        data: { usedAt: expect.any(Date) },
      })
    })

    it('approves a client that was already used', async () => {
      mocks.markUsed.mockResolvedValue({ count: 0 })
      expect((await approve(['files:read'])).status).toBe(200)
      expect(mocks.createCode).toHaveBeenCalledTimes(1)
    })

    it('refuses a client whose registration was removed in the meantime', async () => {
      mocks.markUsed.mockResolvedValue({ count: 0 })
      mocks.findClient.mockResolvedValue(null)
      expect(await refusal(await approve(['files:read']))).toMatch(
        /registration has expired/
      )
    })

    it('leaves state out of the redirect when the client sent none', async () => {
      const { redirect } = await (
        await approve(['files:read'], blob({ state: null }))
      ).json()
      expect([...new URL(redirect).searchParams.keys()]).toEqual([
        'code',
        'iss',
      ])
    })

    it('uses the registered address byte for byte, and appends its answer', async () => {
      // A parser would write %20 back as +, and reorder or re-escape the rest.
      const registered =
        "https://app.example/cb;v=1?tenant=acme%20corp&next=%2Fhome%3Fa%3D1&list=a,b;c&empty=&flag&q=~!*'()"
      for (const decision of ['approve', 'deny'] as const) {
        const { redirect } = await (
          await decide({
            request: blob({ redirectUri: registered }),
            decision,
            scopes: ['files:read'],
          })
        ).json()
        expect(redirect.startsWith(`${registered}&`)).toBe(true)
        const answer = new URLSearchParams(
          redirect.slice(registered.length + 1)
        )
        expect([...answer.keys()]).toEqual(
          decision === 'approve'
            ? ['code', 'state', 'iss']
            : ['error', 'error_description', 'state', 'iss']
        )
        expect(answer.get('iss')).toBe(APP)
        expect(answer.get('state')).toBe('client-state-123')
        // What the client registered still reads as it did.
        expect(new URL(redirect).searchParams.get('tenant')).toBe('acme corp')
      }
    })

    it.each([
      ['no query', 'https://app.example/cb', 'https://app.example/cb?code='],
      [
        'a query',
        'https://app.example/cb?a=1',
        'https://app.example/cb?a=1&code=',
      ],
      [
        'a query that ends in its separator',
        'https://app.example/cb?a=1&',
        'https://app.example/cb?a=1&code=',
      ],
      [
        'an empty query',
        'https://app.example/cb?',
        'https://app.example/cb?code=',
      ],
      [
        'a private scheme',
        'com.example.app:/oauth2redirect',
        'com.example.app:/oauth2redirect?code=',
      ],
      ['a scheme with no path', 'myapp:callback', 'myapp:callback?code='],
    ])(
      'joins its answer to an address with %s',
      async (_what, registered, start) => {
        const { redirect } = await (
          await approve(['files:read'], blob({ redirectUri: registered }))
        ).json()
        expect(redirect.startsWith(start)).toBe(true)
      }
    )

    it('writes its own values so they read back exactly', async () => {
      const state = 'a b+c&d=e#f%20g/ü'
      const { redirect } = await (
        await approve(['files:read'], blob({ state }))
      ).json()
      const url = new URL(redirect)
      expect(url.searchParams.get('state')).toBe(state)
      expect(url.hash).toBe('')
      expect([...url.searchParams.keys()]).toEqual(['code', 'state', 'iss'])
    })

    it('answers a private-scheme client on its own scheme, approving or declining', async () => {
      const request = () =>
        blob({ redirectUri: 'cursor://anysphere.cursor-mcp/oauth/callback' })
      const approved = await (await approve(['files:read'], request())).json()
      expect(approved.redirect).toMatch(
        /^cursor:\/\/anysphere\.cursor-mcp\/oauth\/callback\?code=[A-Za-z0-9_-]{43}&state=client-state-123&iss=/
      )
      const declined = await (
        await decide({ request: request(), decision: 'deny' })
      ).json()
      expect(declined.redirect).toMatch(
        /^cursor:\/\/anysphere\.cursor-mcp\/oauth\/callback\?error=access_denied&/
      )
    })

    it('returns a loopback client to the port it asked for', async () => {
      const { redirect } = await (
        await approve(
          ['files:read'],
          blob({ redirectUri: 'http://localhost:53124/callback' })
        )
      ).json()
      expect(redirect).toMatch(/^http:\/\/localhost:53124\/callback\?code=/)
      expect(mocks.createCode.mock.calls[0][0].data.redirectUri).toBe(
        'http://localhost:53124/callback'
      )
    })

    it('records the decision with the account as actor and the client as target, never the code', async () => {
      const response = await approve(['files:read'])
      const code = new URL((await response.json()).redirect).searchParams.get(
        'code'
      )!
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.authorize',
          category: 'authentication',
          outcome: 'success',
          method: 'POST',
          targetType: 'oauth_client',
          targetId: CLIENT_ID,
          targetName: 'Claude',
        }),
      ])
      const logged = JSON.stringify(events)
      expect(logged).not.toContain(code)
      expect(logged).not.toContain(hashApiToken(code))
      expect(logged).not.toContain(CHALLENGE)
    })
  })
})

describe('while the MCP server is off', () => {
  it('answers 404 to both, and reads nothing', async () => {
    enabled = false
    signedIn()
    for (const response of [
      await authorize(),
      await POST(
        new Request(`${APP}/api/oauth/authorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: APP },
          body: '{}',
        })
      ),
    ]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not found' })
    }
    expect(mocks.findClient).not.toHaveBeenCalled()
    expect(mocks.serverSession).not.toHaveBeenCalled()
    expect(mocks.accessSession).not.toHaveBeenCalled()
    await auditSettled()
    expect(events).toEqual([])
  })
})
