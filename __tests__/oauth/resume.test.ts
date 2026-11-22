import { NextRequest } from 'next/server'

import { GET as resume } from '@/app/api/oauth/authorize/resume/route'
import { proxy } from '@/proxy'
import { encode } from 'next-auth/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { DEFAULT_CONFIG } from '@/lib/config'
import { resumesAgentSignIn } from '@/lib/middleware/agent-sign-in'
import {
  PENDING_COOKIE,
  REQUEST_COOKIE,
  RESUME_PATH,
} from '@/lib/oauth/constants'
import {
  clearedCookies,
  fitsCookie,
  pendingCookies,
  pendingQuery,
  storedQuery,
} from '@/lib/oauth/cookies'

const mocks = vi.hoisted(() => ({ config: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))

const APP = 'http://localhost:3000'
const SECRET = 'a-session-secret-for-tests-of-at-least-32-characters'
const STORED =
  'response_type=code&client_id=flc_abc&redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fcallback&code_challenge=xyz&code_challenge_method=S256&state=s1'

const events: Partial<AuditInput>[] = []
let enabled = true
let sessionCookie = ''

beforeEach(async () => {
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
  sessionCookie = `next-auth.session-token=${await encode({
    token: { id: 'user-alex', sessionVersion: 1 },
    secret: SECRET,
  })}`
})
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
})

describe('the cookies that carry a sign-in across the login page', () => {
  it('are named as the pages that resume it expect', () => {
    expect(REQUEST_COOKIE).toBe('flare_oauth_request')
    expect(PENDING_COOKIE).toBe('flare_oauth_pending')
    expect(RESUME_PATH).toBe('/api/oauth/authorize/resume')
  })

  it('last ten minutes; only the marker can be read by scripts', () => {
    expect(pendingCookies(STORED, true)).toEqual([
      `flare_oauth_request=${STORED}; Path=/; Max-Age=600; SameSite=Lax; Secure; HttpOnly`,
      'flare_oauth_pending=1; Path=/; Max-Age=600; SameSite=Lax; Secure',
    ])
    expect(pendingCookies(STORED, false)).toEqual([
      `flare_oauth_request=${STORED}; Path=/; Max-Age=600; SameSite=Lax; HttpOnly`,
      'flare_oauth_pending=1; Path=/; Max-Age=600; SameSite=Lax',
    ])
  })

  it('are cleared with the attributes they were set with', () => {
    expect(clearedCookies(true)).toEqual([
      'flare_oauth_request=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly',
      'flare_oauth_pending=; Path=/; Max-Age=0; SameSite=Lax; Secure',
    ])
  })

  it('store a query in characters that are safe in a cookie', () => {
    const stored = storedQuery(
      new URLSearchParams({
        client_id: 'flc_abc',
        state: 'a;b,c "d" \\e\r\nSet-Cookie: x=y; =&%',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback?a=1&b=2',
        scope: 'files:read urls:read',
      })
    )
    expect(stored).toMatch(/^[A-Za-z0-9*\-._+%=&]+$/)
    // And it reads back as what was stored.
    expect(Object.fromEntries(new URLSearchParams(stored))).toEqual({
      client_id: 'flc_abc',
      state: 'a;b,c "d" \\e\r\nSet-Cookie: x=y; =&%',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback?a=1&b=2',
      scope: 'files:read urls:read',
    })
  })

  it('store only the parameters an authorize request has', () => {
    const stored = new URLSearchParams(
      storedQuery(
        new URLSearchParams(
          'client_id=a&next=https%3A%2F%2Fevil.example&resource=r1&resource=r2&prompt=none&__proto__=x'
        )
      )
    )
    expect([...stored.keys()]).toEqual(['client_id', 'resource', 'resource'])
    expect(stored.getAll('resource')).toEqual(['r1', 'r2'])
  })

  it('fit in one cookie of 4096 bytes with its name, and say when they would not', () => {
    const room = 4096 - 'flare_oauth_request='.length
    expect(fitsCookie('a'.repeat(room))).toBe(true)
    expect(fitsCookie('a'.repeat(room + 1))).toBe(false)
    // A state of 512 characters that each take three, with everything else.
    const worst = storedQuery(
      new URLSearchParams({
        response_type: 'code',
        client_id: `flc_${'c'.repeat(43)}`,
        redirect_uri: `https://claude.ai/${'~'.repeat(100)}`,
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        state: '~'.repeat(512),
        scope:
          'files:upload files:read files:content files:organize files:share files:delete urls:read urls:write',
        resource: 'https://files.example.com/api/mcp',
      })
    )
    expect(worst.length).toBeGreaterThan(2000)
    expect(fitsCookie(worst)).toBe(true)
  })

  const request = (cookie?: string) =>
    new Request(`${APP}${RESUME_PATH}`, {
      headers: cookie ? { cookie } : {},
    })

  it('read the stored query back from among other cookies', () => {
    expect(
      pendingQuery(
        request(
          `theme=dark; ${REQUEST_COOKIE}=${STORED}; ${PENDING_COOKIE}=1; ${sessionCookie}`
        )
      )
    ).toBe(STORED)
  })

  it.each([
    ['no cookie at all', undefined],
    ['other cookies only', 'theme=dark; flare_oauth_pending=1'],
    ['an empty value', 'flare_oauth_request='],
    ['a value over 4 KB', `flare_oauth_request=state%3D${'s'.repeat(4096)}`],
    ['no parameter an authorize request has', 'flare_oauth_request=next%3Dx'],
    [
      'a cookie whose name only ends the same',
      `not_flare_oauth_request=${STORED}`,
    ],
  ])('find nothing waiting for %s', (_what, cookie) => {
    expect(pendingQuery(request(cookie))).toBeNull()
  })
})

describe('GET /api/oauth/authorize/resume', () => {
  const get = (cookie?: string, headers: Record<string, string> = {}) =>
    resume(
      new Request(`${APP}${RESUME_PATH}`, {
        headers: { ...(cookie ? { cookie } : {}), ...headers },
      })
    )
  const CLEARED = [
    'flare_oauth_request=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly',
    'flare_oauth_pending=; Path=/; Max-Age=0; SameSite=Lax',
  ]

  it('goes to the authorize endpoint with the stored query, and clears both cookies', async () => {
    const response = await get(
      `${REQUEST_COOKIE}=${STORED}; ${PENDING_COOKIE}=1; ${sessionCookie}`
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `/api/oauth/authorize?${STORED}`
    )
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('goes to the dashboard when nothing waits, and still clears the marker', async () => {
    for (const cookie of [undefined, `${PENDING_COOKIE}=1`, sessionCookie]) {
      const response = await get(cookie)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/dashboard')
      expect(response.headers.getSetCookie()).toEqual(CLEARED)
    }
  })

  it('clears with Secure when the instance is served over https', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example.com')
    const response = await get(`${REQUEST_COOKIE}=${STORED}`)
    for (const cookie of response.headers.getSetCookie())
      expect(cookie).toMatch(/Max-Age=0; SameSite=Lax; Secure/)
  })

  it.each([
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example',
    '@evil.example',
    '.evil.example',
    '../../auth/login',
    '/dashboard',
    '?client_id=x',
    '#fragment',
    'javascript:alert(1)',
    '%0d%0aLocation:%20https://evil.example/',
    '\r\nLocation: https://evil.example/',
    'client_id=a&redirect_uri=https://evil.example/cb',
    'client_id=a#@evil.example/',
    'client_id=a/../../../evil',
    'client_id=%2F%2Fevil.example',
    'x'.repeat(5000),
    '=',
    '&&&',
    '%',
    '%zz',
    '\u0000',
  ])('cannot be sent anywhere else by the cookie value %j', async (value) => {
    const response = await resume(
      // Headers cannot hold a raw line break; a browser could not send one either.
      new Request(`${APP}${RESUME_PATH}`, {
        headers: {
          cookie: `${REQUEST_COOKIE}=${value.replace(/[\r\n\u0000]/g, '')}`,
        },
      })
    )
    expect(response.status).toBe(302)
    const location = response.headers.get('location')!
    // The dashboard, or the authorize endpoint with nothing but form fields.
    expect(location).toMatch(
      /^(\/dashboard|\/api\/oauth\/authorize\?[A-Za-z0-9*\-._+%=&]+)$/
    )
    const resolved = new URL(location, 'https://files.example.com')
    expect(resolved.origin).toBe('https://files.example.com')
    expect(['/dashboard', '/api/oauth/authorize']).toContain(resolved.pathname)
    expect(resolved.hash).toBe('')
  })

  it('passes a hostile redirect_uri on only as a parameter the authorize endpoint will check', async () => {
    const response = await get(
      `${REQUEST_COOKIE}=client_id=a&redirect_uri=https%3A%2F%2Fevil.example%2Fcb`
    )
    const location = new URL(response.headers.get('location')!, APP)
    expect(location.pathname).toBe('/api/oauth/authorize')
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://evil.example/cb'
    )
  })

  it('clears the cookies and goes to the dashboard while the MCP server is off', async () => {
    enabled = false
    const response = await get(
      `${REQUEST_COOKIE}=${STORED}; ${PENDING_COOKIE}=1`
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/dashboard')
    expect(response.headers.getSetCookie()).toEqual(CLEARED)
  })

  it('reads no session: the authorize endpoint decides who is signed in', async () => {
    await get(`${REQUEST_COOKIE}=${STORED}; ${sessionCookie}`)
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('records nothing for the hop', async () => {
    await get(`${REQUEST_COOKIE}=${STORED}`)
    await auditSettled()
    expect(events).toEqual([])
  })
})

describe('the proxy', () => {
  const NAVIGATION = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 Firefox/131.0',
  }
  const waiting = `${REQUEST_COOKIE}=${STORED}; ${PENDING_COOKIE}=1`
  function page(
    path: string,
    {
      cookies = [sessionCookie, waiting],
      headers = NAVIGATION as Record<string, string>,
      method = 'GET',
    }: {
      cookies?: string[]
      headers?: Record<string, string>
      method?: string
    } = {}
  ) {
    return new NextRequest(new URL(path, APP), {
      method,
      headers: { ...headers, cookie: cookies.join('; ') },
    })
  }
  const resumed = (response: Response) =>
    response.headers.get('location') === `${APP}${RESUME_PATH}`
  const passed = (response: Response) =>
    response.headers.get('x-middleware-next') === '1'

  it('sends a signed-in page navigation to resume when a sign-in waits', async () => {
    for (const path of [
      '/dashboard',
      '/dashboard/settings',
      '/',
      '/admin/users',
    ]) {
      const response = await proxy(page(path))
      expect(response.status, path).toBe(307)
      expect(resumed(response), path).toBe(true)
    }
  })

  it('does nothing of the kind without the cookie', async () => {
    for (const cookies of [
      [sessionCookie],
      // The marker alone holds no request.
      [sessionCookie, `${PENDING_COOKIE}=1`],
      [sessionCookie, `${REQUEST_COOKIE}=`],
    ]) {
      const response = await proxy(page('/dashboard', { cookies }))
      expect(passed(response)).toBe(true)
      expect(response.headers.has('location')).toBe(false)
    }
  })

  it('sends a signed-out visitor to the login page, cookie or not', async () => {
    for (const cookies of [[waiting], []]) {
      const response = await proxy(page('/dashboard', { cookies }))
      expect(response.headers.get('location')).toBe(`${APP}/auth/login`)
    }
  })

  it('treats a session cookie it cannot read as signed out', async () => {
    const response = await proxy(
      page('/dashboard', {
        cookies: ['next-auth.session-token=not-a-token', waiting],
      })
    )
    expect(response.headers.get('location')).toBe(`${APP}/auth/login`)
  })

  it.each<[string, Record<string, string>]>([
    ['a router prefetch', { ...NAVIGATION, 'next-router-prefetch': '1' }],
    ['an RSC request', { ...NAVIGATION, rsc: '1' }],
    [
      'a request with a router state tree',
      { ...NAVIGATION, 'next-router-state-tree': '%5B%22%22%5D' },
    ],
    ['a browser prefetch', { ...NAVIGATION, 'sec-purpose': 'prefetch' }],
    [
      'a browser prerender',
      { ...NAVIGATION, 'sec-purpose': 'prefetch;prerender' },
    ],
    ['a legacy prefetch', { ...NAVIGATION, purpose: 'prefetch' }],
    ['a Firefox prefetch', { ...NAVIGATION, 'x-moz': 'prefetch' }],
    [
      'a data request',
      { accept: '*/*', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' },
    ],
    [
      'a data request that asks for HTML',
      {
        accept: 'text/html',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
      },
    ],
    ['a page loaded in a frame', { ...NAVIGATION, 'sec-fetch-dest': 'iframe' }],
    ['an image', { accept: 'image/*', 'sec-fetch-dest': 'image' }],
    ['a script', { accept: '*/*', 'sec-fetch-dest': 'script' }],
    [
      'a fetch of a document address',
      { ...NAVIGATION, 'sec-fetch-mode': 'cors' },
    ],
    ['a client that says nothing and asks for anything', { accept: '*/*' }],
    ['a client that sends no Accept header', {}],
    ['a client that asks for JSON', { accept: 'application/json' }],
  ])('does not resume on %s', async (_what, headers) => {
    const response = await proxy(page('/dashboard', { headers }))
    expect(resumed(response)).toBe(false)
    expect(passed(response)).toBe(true)
  })

  it('resumes for a browser that sends no Sec-Fetch headers but asks for a page', async () => {
    const response = await proxy(
      page('/dashboard', { headers: { accept: NAVIGATION.accept } })
    )
    expect(resumed(response)).toBe(true)
  })

  it('does not resume on anything but GET', async () => {
    for (const method of ['POST', 'HEAD', 'PUT', 'DELETE'])
      expect(resumed(await proxy(page('/dashboard', { method })))).toBe(false)
  })

  it.each([
    '/auth/login',
    '/auth/login?local=1',
    '/auth/register',
    '/auth/verify-email',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/connect',
    '/auth/connect?request=blob',
  ])('does not resume on the auth page %s', async (path) => {
    const response = await proxy(page(path))
    expect(resumed(response)).toBe(false)
    expect(passed(response)).toBe(true)
  })

  it('does not resume on pages that need no session', async () => {
    for (const path of [
      '/abc12/report.pdf',
      '/abc12/report.pdf/raw',
      '/u/abc123',
      '/s/folders/token',
      '/setup',
      '/.well-known/oauth-authorization-server',
    ]) {
      const response = await proxy(page(path))
      expect(resumed(response), path).toBe(false)
    }
  })

  it('judges API paths the same way, though the matcher never sends it one', () => {
    expect(resumesAgentSignIn(page('/api/oauth/authorize/resume'))).toBe(false)
    expect(resumesAgentSignIn(page('/api/files'))).toBe(false)
    expect(resumesAgentSignIn(page('/dashboard'))).toBe(true)
  })

  it('resumes once: the request the endpoint answers no longer carries the cookie', async () => {
    const first = await proxy(page('/dashboard'))
    expect(resumed(first)).toBe(true)
    const cleared = await resume(
      new Request(`${APP}${RESUME_PATH}`, { headers: { cookie: waiting } })
    )
    expect(
      cleared.headers
        .getSetCookie()
        .every((cookie) => cookie.includes('Max-Age=0'))
    ).toBe(true)
    // The browser drops both; the next navigation is an ordinary one.
    const next = await proxy(page('/dashboard', { cookies: [sessionCookie] }))
    expect(passed(next)).toBe(true)
  })

  describe('the metadata documents', () => {
    it.each([
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-authorization-server',
    ])('lets a signed-out client read %s', async (path) => {
      const response = await proxy(
        new NextRequest(new URL(path, APP), {
          headers: { accept: 'application/json' },
        })
      )
      expect(passed(response)).toBe(true)
      expect(response.headers.has('location')).toBe(false)
    })

    it('still asks for a session on paths that only look alike', async () => {
      for (const path of [
        '/.well-knownx',
        '/dashboard/.well-known/oauth-authorization-server',
      ]) {
        const response = await proxy(new NextRequest(new URL(path, APP)))
        expect(response.headers.get('location'), path).toBe(`${APP}/auth/login`)
      }
    })
  })

  describe('the consent screen', () => {
    it('needs a session', async () => {
      const response = await proxy(
        page('/auth/connect?request=blob', { cookies: [] })
      )
      expect(response.headers.get('location')).toBe(`${APP}/auth/login`)
    })

    it('is never shown in a frame', async () => {
      const response = await proxy(
        page('/auth/connect?request=blob', { cookies: [sessionCookie] })
      )
      expect(passed(response)).toBe(true)
      expect(response.headers.get('x-frame-options')).toBe('DENY')
      expect(response.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'none'"
      )
    })

    it('leaves the framing of other pages as it was', async () => {
      for (const path of ['/dashboard', '/auth/connect/more', '/auth/login']) {
        const response = await proxy(page(path, { cookies: [sessionCookie] }))
        expect(response.headers.has('x-frame-options'), path).toBe(false)
        expect(response.headers.has('content-security-policy'), path).toBe(
          false
        )
      }
    })
  })
})
