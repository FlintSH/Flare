import { DELETE, GET, OPTIONS, POST } from '@/app/api/mcp/route'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
  setAuditOutcome,
  setAuditTarget,
} from '@/lib/audit'
import { DEFAULT_CONFIG } from '@/lib/config'
import { CORS_ENV } from '@/lib/http/cors'
import { HttpError } from '@/lib/http/errors'
import { hashApiToken } from '@/lib/integrations/tokens'
import { loggers } from '@/lib/logger'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  session: vi.fn(),
  token: vi.fn(),
  tokenUpdate: vi.fn(),
  user: vi.fn(),
  everyone: vi.fn(),
  file: vi.fn(),
  queryRaw: vi.fn(),
  fileListPage: vi.fn(),
  accountFileTypes: vi.fn(),
  listFolders: vi.fn(),
  listTags: vi.fn(),
}))
/** A test can stand in for the MCP handler; otherwise the real one serves. */
const handler = vi.hoisted(() => ({
  fetch: undefined as
    undefined | ((request: Request, options?: unknown) => Promise<Response>),
}))
vi.mock('@/lib/mcp/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/server')>()
  return {
    ...actual,
    mcpHandler: () =>
      handler.fetch
        ? { ...actual.mcpHandler(), fetch: handler.fetch }
        : actual.mcpHandler(),
  }
})
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    apiToken: { findUnique: mocks.token, update: mocks.tokenUpdate },
    user: { findUnique: mocks.user },
    role: { findUnique: mocks.everyone },
    file: { findUnique: mocks.file },
    $queryRaw: mocks.queryRaw,
  },
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: vi.fn(async () => ({})),
}))
vi.mock('@/lib/email/policy', () => ({
  requiresEmailVerification: () => false,
}))
vi.mock('@/lib/files/list', () => ({
  fileListPage: mocks.fileListPage,
  accountFileTypes: mocks.accountFileTypes,
}))
vi.mock('@/lib/folders/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/folders/service')>()),
  listFolders: mocks.listFolders,
}))
vi.mock('@/lib/tags/manage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tags/manage')>()),
  listTags: mocks.listTags,
}))

const APP = 'https://flare.test'
const ENDPOINT = `${APP}/api/mcp`
const SITE = 'https://agent.example.com'

const account = {
  id: 'user-1',
  name: 'Alex',
  email: 'alex@example.com',
  image: null,
  sessionVersion: 1,
  passkeyRequired: false,
  emailVerified: null,
  emailVerifiedFor: null,
  emailVerificationSource: null,
  emailExempt: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  storageUsed: 0,
  urlId: 'alex',
  vanityId: null,
  randomizeFileUrls: true,
  roles: [],
}
const storedToken = (id: string, scopes: string[]) => ({
  id,
  userId: account.id,
  scopes,
  profileId: null,
  revokedAt: null,
  expiresAt: null,
  user: account,
})
const TOKENS = new Map([
  [
    hashApiToken('flr_ReadOnly'),
    storedToken('token-read', [
      'files:read',
      'files:content',
      'urls:read',
      'mcp',
    ]),
  ],
  [hashApiToken('flr_Links'), storedToken('token-links', ['urls:read', 'mcp'])],
  // Made for a script: every REST scope, but not the marker.
  [
    hashApiToken('flr_Script'),
    storedToken('token-script', ['files:read', 'files:upload', 'urls:read']),
  ],
])

const events: Partial<AuditInput>[] = []
let enabled = true

beforeEach(() => {
  vi.clearAllMocks()
  handler.fetch = undefined
  events.length = 0
  enabled = true
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
  vi.stubEnv('NEXTAUTH_URL', APP)
  vi.stubEnv(CORS_ENV, '')
  vi.spyOn(loggers.api, 'error').mockImplementation(() => loggers.api)
  mocks.config.mockImplementation(async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.mcp.enabled = enabled
    return config
  })
  mocks.session.mockResolvedValue({ user: { id: 'admin' } })
  mocks.token.mockImplementation(
    async ({ where }: { where: { hash: string } }) =>
      TOKENS.get(where.hash) ?? null
  )
  mocks.tokenUpdate.mockResolvedValue({})
  mocks.everyone.mockResolvedValue({
    id: 'everyone',
    name: 'Everyone',
    description: '',
    color: '#64748b',
    position: 0,
    systemKey: 'everyone',
    permissions: [...DEFAULT_PERMISSIONS],
  })
  mocks.queryRaw.mockResolvedValue([])
  mocks.listFolders.mockResolvedValue([])
  mocks.listTags.mockResolvedValue([])
  mocks.accountFileTypes.mockResolvedValue([])
  mocks.fileListPage.mockResolvedValue({
    files: [],
    pagination: { total: 0, pageCount: 0, page: 1, limit: 20 },
  })
})
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

type Init = {
  method?: string
  token?: string | null
  origin?: string
  headers?: Record<string, string>
  url?: string
}

function request(body: unknown, init: Init = {}) {
  const {
    method = 'POST',
    token = 'flr_ReadOnly',
    origin,
    url = ENDPOINT,
  } = init
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
    ...init.headers,
  })
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (origin) headers.set('origin', origin)
  return new Request(url, {
    method,
    headers,
    body:
      method === 'GET' || body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  })
}
const rpc = (method: string, params?: unknown) => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  params,
})
const toolCall = (name: string, args: Record<string, unknown> = {}) =>
  rpc('tools/call', { name, arguments: args })

async function message(response: Response) {
  const text = await response.text()
  return JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text)
}

const ERAS = ['2025-11-25', '2026-07-28'] as const
type Era = (typeof ERAS)[number]

/**
 * A tool call as a client of that protocol revision sends it. The 2026-07-28
 * revision repeats the method and the tool in headers and carries the
 * client's details in `_meta`.
 */
function callAs(
  era: Era,
  name: string,
  args: Record<string, unknown> = {},
  init: Init = {}
) {
  if (era === '2025-11-25') return request(toolCall(name, args), init)
  return request(
    rpc('tools/call', {
      name,
      arguments: args,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': era,
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    }),
    {
      ...init,
      headers: {
        'mcp-protocol-version': era,
        'mcp-method': 'tools/call',
        'mcp-name': name,
        ...init.headers,
      },
    }
  )
}

/** A service that answers after a turn of the event loop, as a database does. */
const afterATurn =
  <T>(answer: () => T) =>
  async () => {
    await new Promise((resolve) => setImmediate(resolve))
    return answer()
  }

/** What the audit log holds once deferred reads are written. */
async function recorded() {
  await auditSettled()
  return events
}

/** No service under any tool was reached. */
const servedTools = () => {
  expect(mocks.fileListPage).not.toHaveBeenCalled()
  expect(mocks.file).not.toHaveBeenCalled()
  expect(mocks.listFolders).not.toHaveBeenCalled()
  expect(mocks.listTags).not.toHaveBeenCalled()
}

const servedNothing = () => {
  expect(mocks.token).not.toHaveBeenCalled()
  expect(mocks.fileListPage).not.toHaveBeenCalled()
}

describe('while the MCP server is off', () => {
  beforeEach(() => {
    enabled = false
  })

  it.each([
    ['GET', GET],
    ['POST', POST],
    ['DELETE', DELETE],
  ])('answers %s as if the route did not exist', async (method, handler) => {
    const response = await handler(
      request(method === 'POST' ? toolCall('search_files') : undefined, {
        method,
      })
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('www-authenticate')).toBe(false)
    expect(response.headers.has('allow')).toBe(false)
    servedNothing()
    expect(await recorded()).toEqual([])
  })

  it('answers the same without a credential, so the answer says nothing about tokens', async () => {
    const response = await POST(request(rpc('tools/list'), { token: null }))
    expect(response.status).toBe(404)
    expect(response.headers.has('www-authenticate')).toBe(false)
  })

  it('answers 404, not 403, to another site', async () => {
    const response = await POST(
      request(rpc('tools/list'), { origin: 'https://evil.example' })
    )
    expect(response.status).toBe(404)
  })

  it('answers a preflight as if the route did not exist', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = await OPTIONS(
      request(undefined, {
        method: 'OPTIONS',
        token: null,
        origin: SITE,
        headers: { 'access-control-request-method': 'POST' },
      })
    )
    expect(response.status).toBe(404)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('serves again once it is turned on, without a restart', async () => {
    expect((await POST(request(rpc('tools/list')))).status).toBe(404)
    enabled = true
    expect((await POST(request(rpc('tools/list')))).status).toBe(200)
  })
})

describe('browser origins', () => {
  const served = async (init: Init) => {
    const response = await POST(request(toolCall('search_files'), init))
    return response.status
  }

  it('serves a request without an Origin, as every non-browser client sends', async () => {
    expect(await served({})).toBe(200)
    expect(mocks.fileListPage).toHaveBeenCalledTimes(1)
  })

  it("serves Flare's own origin", async () => {
    expect(await served({ origin: APP })).toBe(200)
  })

  it("serves Flare's public origin behind a reverse proxy, where the request URL is internal", async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://files.example.com')
    expect(
      await served({
        origin: 'https://files.example.com',
        url: 'http://127.0.0.1:3000/api/mcp',
      })
    ).toBe(200)
  })

  it("serves the request's own origin when no public address is set", async () => {
    vi.stubEnv('NEXTAUTH_URL', '')
    expect(await served({ origin: APP })).toBe(200)
  })

  it('serves an origin FLARE_CORS_ORIGINS lists', async () => {
    vi.stubEnv(CORS_ENV, `https://other.example ${SITE}`)
    expect(await served({ origin: SITE })).toBe(200)
  })

  it('serves any origin when FLARE_CORS_ORIGINS is *', async () => {
    vi.stubEnv(CORS_ENV, '*')
    expect(await served({ origin: 'https://anything.example' })).toBe(200)
  })

  it.each([
    ['another site', 'https://evil.example', ''],
    ['a site that is not in the list', 'https://evil.example', SITE],
    ['the same host on another port', 'https://flare.test:8443', ''],
    ['the same host over http', 'http://flare.test', ''],
    ['a subdomain', 'https://app.flare.test', ''],
    ['an opaque origin', 'null', SITE],
  ])(
    'refuses %s before reading the credential',
    async (_what, origin, cors) => {
      vi.stubEnv(CORS_ENV, cors)
      const response = await POST(request(toolCall('search_files'), { origin }))
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'This origin may not use the MCP server.',
      })
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
      servedNothing()
      // A refusal is worth a line, though no tool was reached: the action is
      // never the tool the body names.
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.request',
          category: 'mcp',
          outcome: 'denied',
          status: 403,
          route: '/api/mcp',
          actorName: 'Anonymous',
        }),
      ])
      expect(events[0].actorId).toBeUndefined()
    }
  )

  it('refuses another site whatever the method', async () => {
    for (const [method, handler] of [
      ['GET', GET],
      ['DELETE', DELETE],
    ] as const) {
      const response = await handler(
        request(undefined, { method, origin: 'https://evil.example' })
      )
      expect(response.status).toBe(403)
    }
    expect(
      (await recorded()).map((event) => `${event.action} ${event.outcome}`)
    ).toEqual(['mcp.request denied', 'mcp.request denied'])
  })

  it('records nothing for an origin it serves', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    await (await POST(request(rpc('tools/list'), { origin: SITE }))).text()
    expect(await recorded()).toEqual([])
  })
})

describe('methods', () => {
  it.each([
    ['GET', GET],
    ['DELETE', DELETE],
  ])(
    'answers %s with 405 and Allow: POST: there is no stream to open and no session to end',
    async (method, handler) => {
      for (const token of ['flr_ReadOnly', null]) {
        const response = await handler(request(undefined, { method, token }))
        expect(response.status).toBe(405)
        expect(response.headers.get('allow')).toBe('POST')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({ error: 'Method not allowed.' })
      }
      servedNothing()
      expect(await recorded()).toEqual(
        Array(2).fill(
          expect.objectContaining({
            action: 'mcp.request',
            category: 'mcp',
            outcome: 'failure',
            status: 405,
            method,
            route: '/api/mcp',
          })
        )
      )
    }
  )

  it('opens no event stream for a GET that asks for one', async () => {
    const response = await GET(
      request(undefined, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      })
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })
})

describe('request size', () => {
  const LIMIT = 1024 * 1024

  it('refuses a body announced as larger than 1 MiB without reading it', async () => {
    const text = vi.fn(async () => '{}')
    const announced = request(toolCall('search_files'), {
      headers: { 'content-length': String(LIMIT + 1) },
    })
    announced.text = text
    const response = await POST(announced)
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Request body too large.' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(text).not.toHaveBeenCalled()
    servedNothing()
    // Recorded as a failed request: the body was never read, so no tool is named.
    expect(await recorded()).toEqual([
      expect.objectContaining({
        action: 'mcp.request',
        category: 'mcp',
        outcome: 'failure',
        status: 413,
        route: '/api/mcp',
      }),
    ])
  })

  it('refuses a body that is larger than 1 MiB whatever its length header says', async () => {
    const padding = 'x'.repeat(LIMIT)
    const lengths: Record<string, string>[] = [{}, { 'content-length': '2' }]
    for (const headers of lengths) {
      const response = await POST(
        request(toolCall('search_files', { query: padding }), { headers })
      )
      expect(response.status).toBe(413)
    }
    servedNothing()
    // The tool named inside a body that large is not what gets recorded.
    expect(
      (await recorded()).map((event) => `${event.action} ${event.outcome}`)
    ).toEqual(['mcp.request failure', 'mcp.request failure'])
    expect(JSON.stringify(events).length).toBeLessThan(2000)
  })

  /** A body that states no length and produces data until it is cancelled. */
  function endless(chunkBytes = 64 * 1024) {
    const source = { pulled: 0, cancelled: vi.fn() }
    const chunk = new Uint8Array(chunkBytes).fill(0x20)
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          source.pulled += chunk.byteLength
          controller.enqueue(chunk)
        },
        cancel: source.cancelled,
      },
      // Nothing is produced ahead of the reader.
      { highWaterMark: 0 }
    )
    return { source, body }
  }
  const streamed = (body: ReadableStream<Uint8Array>, init: Init = {}) => {
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...init.headers,
    })
    if (init.token !== null)
      headers.set('authorization', `Bearer ${init.token ?? 'flr_ReadOnly'}`)
    return new Request(ENDPOINT, {
      method: 'POST',
      headers,
      body,
      // Node asks for this when a request body is a stream.
      duplex: 'half',
    } as RequestInit)
  }
  /** Fails the test, instead of hanging it, if the route never answers. */
  async function answered(response: Promise<Response>) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        response,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('The route kept reading the body')),
            3000
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  it('stops reading a body that states no length and never ends, at about 1 MiB', async () => {
    const { source, body } = endless()
    const request = streamed(body)
    expect(request.headers.has('content-length')).toBe(false)
    const response = await answered(POST(request))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Request body too large.' })
    // It read just past the limit, then let go of the sender.
    expect(source.cancelled).toHaveBeenCalledTimes(1)
    expect(source.pulled).toBeGreaterThan(LIMIT)
    expect(source.pulled).toBeLessThanOrEqual(LIMIT + 2 * 64 * 1024)
    // Nothing is pulled once the answer is out.
    const after = source.pulled
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(source.pulled).toBe(after)
    servedNothing()
    expect(await recorded()).toEqual([
      expect.objectContaining({
        action: 'mcp.request',
        category: 'mcp',
        outcome: 'failure',
        status: 413,
        route: '/api/mcp',
      }),
    ])
  })

  it('stops as soon for small chunks and for one huge one', async () => {
    for (const chunkBytes of [1024, 4 * LIMIT]) {
      const { source, body } = endless(chunkBytes)
      const response = await answered(POST(streamed(body)))
      expect(response.status, String(chunkBytes)).toBe(413)
      expect(source.cancelled).toHaveBeenCalledTimes(1)
      expect(source.pulled).toBeLessThanOrEqual(LIMIT + 2 * chunkBytes)
    }
    servedNothing()
  })

  it('stops reading an endless body from a caller without a credential too', async () => {
    const { source, body } = endless()
    const response = await answered(POST(streamed(body, { token: null })))
    // The size is checked before anyone is asked who they are.
    expect(response.status).toBe(413)
    expect(source.cancelled).toHaveBeenCalledTimes(1)
  })

  it('serves a streamed body that ends within the limit', async () => {
    const call = new TextEncoder().encode(
      JSON.stringify(toolCall('search_files', { query: 'report' }))
    )
    // Sent a few bytes at a time, as a slow sender would.
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= call.length) return controller.close()
        controller.enqueue(call.subarray(sent, (sent += 7)))
      },
    })
    const response = await answered(POST(streamed(body)))
    expect(response.status).toBe(200)
    expect((await message(response)).result.structuredContent).toEqual({
      files: [],
      total: 0,
    })
    expect(mocks.fileListPage).toHaveBeenCalledTimes(1)
  })

  it('reads a multi-byte character split between two chunks whole', async () => {
    const call = new TextEncoder().encode(
      JSON.stringify(toolCall('search_files', { query: 'año €100 😀' }))
    )
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= call.length) return controller.close()
        // One byte at a time cuts every multi-byte character.
        controller.enqueue(call.subarray(sent, ++sent))
      },
    })
    const response = await answered(POST(streamed(body)))
    expect(response.status).toBe(200)
    const [, query] = mocks.fileListPage.mock.calls[0]
    expect(query.get('search')).toBe('año €100 😀')
  })

  it('counts bytes, not characters', async () => {
    // 400,000 three-byte characters: under the limit in characters, over in bytes.
    const response = await POST(
      request(toolCall('search_files', { query: '€'.repeat(400_000) }))
    )
    expect(response.status).toBe(413)
    servedNothing()
  })

  it('serves a body just under the limit', async () => {
    const call = JSON.stringify(toolCall('search_files', { query: 'report' }))
    // JSON may end in whitespace; the padding changes nothing but the size.
    const response = await POST(request(call + ' '.repeat(LIMIT - call.length)))
    expect(response.status).toBe(200)
    expect(mocks.fileListPage).toHaveBeenCalledTimes(1)
  })
})

describe('authentication', () => {
  it.each<[string, Init]>([
    ['no credential', { token: null }],
    ['a token nobody issued', { token: 'flr_Unknown' }],
    ['a named token without Agent access', { token: 'flr_Script' }],
    ['the legacy upload token', { token: 'legacy-upload-token' }],
    [
      'only a browser session cookie',
      {
        token: null,
        headers: { cookie: 'next-auth.session-token=an-administrator' },
      },
    ],
    [
      'another scheme',
      { token: null, headers: { authorization: 'Basic flr_ReadOnly' } },
    ],
  ])('answers %s with 401 and a Bearer challenge', async (_what, init) => {
    // The legacy upload token would find the account if anything looked.
    mocks.user.mockResolvedValue(account)
    const response = await POST(request(toolCall('search_files'), init))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="Flare MCP"'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      error: 'unauthorized',
      error_description:
        'Send an API token that has Agent access as "Authorization: Bearer <token>". Create one in Flare under Profile, Integrations.',
    })
    expect(mocks.fileListPage).not.toHaveBeenCalled()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.user).not.toHaveBeenCalled()
  })

  it('serves the tools of the token, not of a session on the same request', async () => {
    const response = await POST(
      request(rpc('tools/list'), {
        token: 'flr_Links',
        headers: { cookie: 'next-auth.session-token=an-administrator' },
      })
    )
    const { result } = await message(response)
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'get_account',
      'list_short_links',
    ])
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('does not list a tool the token may not call, even right after it tried to call it', async () => {
    const links = { token: 'flr_Links' }
    await (await POST(request(toolCall('search_files'), links))).text()
    const { result } = await message(
      await POST(request(rpc('tools/list'), links))
    )
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'get_account',
      'list_short_links',
    ])
    expect(mocks.fileListPage).not.toHaveBeenCalled()
  })

  it.each(ERAS)('serves a %s client', async (era) => {
    const answer = await message(await POST(callAs(era, 'search_files')))
    expect(answer.result.structuredContent).toEqual({ files: [], total: 0 })
    expect(mocks.fileListPage).toHaveBeenCalledTimes(1)
  })

  it('answers a tool call with HTTP 200 even when the tool fails', async () => {
    mocks.fileListPage.mockRejectedValue(new Error('database down'))
    const response = await POST(request(toolCall('search_files')))
    expect(response.status).toBe(200)
    expect((await message(response)).result.isError).toBe(true)
  })
})

const FILE = {
  id: 'file-1',
  name: 'report.pdf',
  urlPath: '/alex/report.pdf',
  mimeType: 'application/pdf',
  size: 1,
  uploadedAt: new Date('2026-11-01T00:00:00.000Z'),
  visibility: 'PRIVATE',
  password: null,
  views: 0,
  downloads: 0,
  folderId: null,
  user: { urlId: 'alex' },
  tags: [],
  userId: 'user-1',
  isPaste: false,
  isOcrProcessed: false,
  ocrText: null,
}

describe.each(ERAS)(
  'the audit event of a tool call from a %s client',
  (era) => {
    const page = {
      files: [],
      pagination: { total: 0, pageCount: 0, page: 1, limit: 20 },
    }
    beforeEach(() => {
      mocks.fileListPage.mockImplementation(afterATurn(() => page))
      mocks.file.mockImplementation(afterATurn(() => FILE))
    })
    /** One call, read to its end as a client reads it. */
    const callTool = async (
      name: string,
      args: Record<string, unknown> = {},
      init: Init = {}
    ) => {
      const response = await POST(callAs(era, name, args, init))
      return { status: response.status, answer: await message(response) }
    }

    it('is mcp.<tool> with the account, the token and the duration', async () => {
      const { answer } = await callTool('search_files', { query: 'report' })
      expect(answer.result.structuredContent).toEqual({ files: [], total: 0 })
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          category: 'mcp',
          outcome: 'success',
          actorId: 'user-1',
          actorName: 'Alex',
          method: 'POST',
          route: '/api/mcp',
          status: 200,
          details: { tokenId: 'token-read', durationMs: expect.any(Number) },
        }),
      ])
    })

    it('covers the whole call in its duration', async () => {
      mocks.fileListPage.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return page
      })
      await callTool('search_files')
      const [event] = await recorded()
      expect(event.details?.durationMs).toBeGreaterThanOrEqual(55)
    })

    it('names the file the call was about as its target', async () => {
      const { answer } = await callTool('get_file', { file: 'file-1' })
      expect(answer.result.isError).toBeFalsy()
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.get_file',
          outcome: 'success',
          targetType: 'file',
          targetId: 'file-1',
          targetName: 'report.pdf',
        }),
      ])
    })

    it('holds the route, never the arguments or the credential', async () => {
      await callTool('search_files', { query: 'confidential-merger' })
      await callTool('search_files', { cursor: 'confidential-cursor' })
      const log = JSON.stringify(await recorded())
      expect(events).toHaveLength(2)
      expect(log).not.toContain('confidential')
      expect(log).not.toContain('flr_ReadOnly')
      for (const event of events) expect(event.route).toBe('/api/mcp')
    })

    it('takes its outcome from the tool result, not the HTTP status: a tool error is a failure', async () => {
      const { status, answer } = await callTool('search_files', {
        cursor: 'not-a-cursor',
      })
      expect(status).toBe(200)
      expect(answer.result.isError).toBe(true)
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'failure',
          status: 200,
        }),
      ])
    })

    it('is a failure when the tool fails unexpectedly, without the error text', async () => {
      mocks.fileListPage.mockImplementation(
        afterATurn(() => {
          throw new Error('database down')
        })
      )
      const { status, answer } = await callTool('search_files')
      expect(status).toBe(200)
      expect(answer.result.isError).toBe(true)
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'failure',
        }),
      ])
      expect(JSON.stringify(events)).not.toContain('database down')
    })

    it('is denied when a service refuses', async () => {
      mocks.fileListPage.mockImplementation(
        afterATurn(() => {
          throw new HttpError(403, 'Not allowed')
        })
      )
      const { status, answer } = await callTool('search_files')
      expect(status).toBe(200)
      expect(answer.result.isError).toBe(true)
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'denied',
          status: 200,
        }),
      ])
    })

    it('is denied when the connection may not use the tool, and the answer says what it lacks', async () => {
      // This token may only list short links.
      const { status, answer } = await callTool(
        'search_files',
        {},
        { token: 'flr_Links' }
      )
      expect(status).toBe(200)
      expect(answer.result?.isError).toBe(true)
      expect(answer.result.content[0].text).toContain(
        '"Read files" (files:read)'
      )
      expect(answer.result.content[0].text).toContain('Profile, Integrations')
      expect(mocks.fileListPage).not.toHaveBeenCalled()
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'denied',
          status: 200,
          details: expect.objectContaining({ tokenId: 'token-links' }),
        }),
      ])
    })

    it('is a failure when the arguments are not ones the tool accepts', async () => {
      const { answer } = await callTool('search_files', { limit: 1000 })
      expect(answer.result?.structuredContent).toBeUndefined()
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'failure',
        }),
      ])
      expect(mocks.fileListPage).not.toHaveBeenCalled()
    })

    it('is denied, under the tool it tried, when the credential is refused', async () => {
      const { status } = await callTool(
        'search_files',
        {},
        { token: 'flr_Script' }
      )
      expect(status).toBe(401)
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'denied',
          status: 401,
          actorName: 'Anonymous',
        }),
      ])
      expect(events[0].actorId).toBeUndefined()
    })

    it('belongs to its own request: outcomes and targets do not carry over', async () => {
      await callTool('search_files', { cursor: 'bad' })
      await callTool('get_file', { file: 'file-1' })
      mocks.fileListPage.mockImplementationOnce(
        afterATurn(() => {
          throw new HttpError(403, 'Not allowed')
        })
      )
      await callTool('search_files')
      await callTool('search_files')
      const lines = (await recorded())
        .map(
          (event) =>
            `${event.action} ${event.outcome} ${event.targetId ?? 'no target'}`
        )
        .sort()
      expect(lines).toEqual([
        'mcp.get_file success file-1',
        'mcp.search_files denied no target',
        'mcp.search_files failure no target',
        'mcp.search_files success no target',
      ])
      expect(new Set(events.map((event) => event.requestId)).size).toBe(4)
    })
  }
)

describe('audit', () => {
  it.each([
    [
      'initialize',
      rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    ],
    ['tools/list', rpc('tools/list')],
    ['ping', rpc('ping')],
    [
      'notifications/initialized',
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ],
  ])('does not record a successful %s', async (_method, body) => {
    const response = await POST(request(body))
    expect(response.status).toBeLessThan(300)
    await response.text()
    expect(await recorded()).toEqual([])
  })

  it('records a request that is not a tool call as mcp.request when it is refused', async () => {
    const response = await POST(request(rpc('tools/list'), { token: null }))
    expect(response.status).toBe(401)
    expect(await recorded()).toEqual([
      expect.objectContaining({
        action: 'mcp.request',
        category: 'mcp',
        outcome: 'denied',
        status: 401,
        actorName: 'Anonymous',
        route: '/api/mcp',
      }),
    ])
    expect(events[0].actorId).toBeUndefined()
  })

  it('records a body that is not JSON-RPC as a failed mcp.request', async () => {
    const response = await POST(request('{not json'))
    expect(response.status).toBe(400)
    expect(await recorded()).toEqual([
      expect.objectContaining({
        action: 'mcp.request',
        outcome: 'failure',
        status: 400,
      }),
    ])
  })

  describe('a tool call that names something every object has', () => {
    // None of these is a row of the catalog, though the catalog object, like
    // any object, answers to each of them.
    const INHERITED = [
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'valueOf',
      'isPrototypeOf',
      '__defineGetter__',
    ]

    it.each(INHERITED)(
      'answers %s with 401 when no credential is sent, never a 500',
      async (name) => {
        const response = await POST(request(toolCall(name), { token: null }))
        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toBe(
          'Bearer realm="Flare MCP"'
        )
        expect(await recorded()).toEqual([
          expect.objectContaining({
            action: 'mcp.request',
            category: 'mcp',
            outcome: 'denied',
            status: 401,
          }),
        ])
      }
    )

    it.each(ERAS)(
      'answers each with the unknown-tool error for a %s client that is signed in',
      async (era) => {
        for (const name of INHERITED) {
          const response = await POST(callAs(era, name))
          expect(response.status, name).toBe(200)
          const answer = await message(response)
          // The protocol layer's answer for a tool this server does not
          // offer. It words the names every object has as "disabled".
          expect(answer.result, name).toBeUndefined()
          expect(answer.error?.code, name).toBe(-32602)
          expect(answer.error?.message, name).toMatch(
            new RegExp(`^Tool ${name} (not found|disabled)$`)
          )
        }
        expect(loggers.api.error).not.toHaveBeenCalled()
        // A 200 for something that is not a tool leaves no line, and no action
        // was ever built from the name.
        expect(await recorded()).toEqual([])
      }
    )

    it('runs nothing for any of them, whatever the connection may call', async () => {
      for (const name of INHERITED)
        await (await POST(request(toolCall(name, { file: 'x' })))).text()
      servedTools()
    })
  })

  it('never puts a name the caller made up into the action', async () => {
    for (const name of ['drop_database', 'x'.repeat(200), 'request', '../x'])
      await (await POST(request(toolCall(name)))).text()
    await POST(request(toolCall('drop_database'), { token: null }))
    for (const action of (await recorded()).map((event) => event.action))
      expect(action).toBe('mcp.request')
    expect(events.length).toBeGreaterThan(0)
  })

  it.each(ERAS)(
    'refuses a JSON-RPC batch from a %s client: no tool runs under an entry that names none',
    async (era) => {
      const response = await POST(
        request(
          [toolCall('search_files'), { ...toolCall('search_files'), id: 2 }],
          { headers: { 'mcp-protocol-version': era } }
        )
      )
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message:
            'Batch requests are not supported. Send one request at a time.',
        },
      })
      // Refused before the credential is read and before any tool.
      servedNothing()
      expect(await recorded()).toEqual([
        expect.objectContaining({
          action: 'mcp.request',
          category: 'mcp',
          outcome: 'failure',
          status: 400,
        }),
      ])
    }
  )

  it.each([
    ['an empty batch', []],
    ['a batch of one call', [toolCall('search_files')]],
    [
      'a batch that mixes a call with a notification',
      [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        toolCall('search_files'),
      ],
    ],
    ['a batch without a credential', [toolCall('search_files')]],
  ])('refuses %s the same way', async (what, body) => {
    const response = await POST(
      request(body, { token: what.endsWith('credential') ? null : undefined })
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe(-32600)
    expect(mocks.fileListPage).not.toHaveBeenCalled()
    expect(
      (await recorded()).map((event) => `${event.action} ${event.outcome}`)
    ).toEqual(['mcp.request failure'])
  })

  it('records a successful read after answering, as successful GETs are', async () => {
    const response = await POST(callAs('2026-07-28', 'search_files'))
    expect(events).toEqual([])
    await response.text()
    expect(await recorded()).toHaveLength(1)
  })

  it('records a failed call before answering', async () => {
    await POST(callAs('2026-07-28', 'search_files', { cursor: 'bad' }))
    expect(events).toHaveLength(1)
  })
})

describe('answers that are streams', () => {
  const encoder = new TextEncoder()
  const EVENT_STREAM = { 'content-type': 'text/event-stream' }
  const sse = (message: unknown) =>
    encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
  /** Resolves with `late` if the promise has not settled within a second. */
  async function within<T>(promise: Promise<T>): Promise<T | 'late'> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<'late'>((resolve) => {
          timer = setTimeout(() => resolve('late'), 1000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /** A handler whose answer stays open, as one to a client that listens does. */
  function listening() {
    const cancelled = vi.fn()
    handler.fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                sse({
                  jsonrpc: '2.0',
                  method: 'notifications/subscriptions/acknowledged',
                })
              )
              // Never closed: the client decides when to leave.
            },
            cancel: cancelled,
          }),
          {
            status: 200,
            headers: { ...EVENT_STREAM, 'x-accel-buffering': 'no' },
          }
        )
    )
    return cancelled
  }
  const listen = (init: Init = {}) =>
    request(rpc('subscriptions/listen', { notifications: {} }), {
      ...init,
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'subscriptions/listen',
        ...init.headers,
      },
    })

  it('hands back a stream that never ends without waiting for its end', async () => {
    const cancelled = listening()
    const response = await within(POST(listen()))
    if (response === 'late')
      throw new Error('The route waited for a stream that never ends')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(handler.fetch).toHaveBeenCalledTimes(1)

    // What the handler wrote so far arrives, and the stream is still open.
    const reader = response.body!.getReader()
    const first = await within(reader.read())
    if (first === 'late') throw new Error('The first event never arrived')
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toContain(
      'notifications/subscriptions/acknowledged'
    )
    const second = await Promise.race([
      reader.read().then(() => 'ended or wrote'),
      new Promise((resolve) => setTimeout(() => resolve('still open'), 50)),
    ])
    expect(second).toBe('still open')

    // Nothing was refused, so nothing is recorded; the client leaving ends it.
    expect(await recorded()).toEqual([])
    await reader.cancel()
    expect(cancelled).toHaveBeenCalled()
  })

  it.each([
    ['tools/list', rpc('tools/list')],
    [
      'initialize',
      rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      }),
    ],
    ['a call to a tool that does not exist', toolCall('drop_database')],
  ])(
    'does not wait for the end of the answer to %s either',
    async (_what, body) => {
      listening()
      const response = await within(POST(request(body)))
      if (response === 'late') throw new Error('The route waited')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      await response.body!.cancel()
      expect(await recorded()).toEqual([])
    }
  )

  it('still lets an allowed origin read a stream it leaves open', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    listening()
    const response = await within(POST(listen({ origin: SITE })))
    if (response === 'late') throw new Error('The route waited')
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    await response.body!.cancel()
  })

  it('still authenticates before it hands a stream back', async () => {
    listening()
    const response = await POST(listen({ token: null }))
    expect(response.status).toBe(401)
    expect(handler.fetch).not.toHaveBeenCalled()
  })

  it('reads a tool call to its end before writing the audit entry, so the entry holds what the tool set late', async () => {
    let finished = false
    handler.fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              // The answer exists while the tool is still working.
              await new Promise((resolve) => setTimeout(resolve, 40))
              setAuditTarget({ type: 'file', id: 'file-9', name: 'late.txt' })
              setAuditOutcome('denied')
              controller.enqueue(
                sse({
                  jsonrpc: '2.0',
                  id: 1,
                  result: {
                    content: [{ type: 'text', text: 'Not allowed' }],
                    isError: true,
                  },
                })
              )
              finished = true
              controller.close()
            },
          }),
          { status: 200, headers: EVENT_STREAM }
        )
    )
    const response = await POST(request(toolCall('get_file', { file: 'x' })))
    // The route came back only once the tool was done, entry already written.
    expect(finished).toBe(true)
    expect(events).toEqual([
      expect.objectContaining({
        action: 'mcp.get_file',
        category: 'mcp',
        outcome: 'denied',
        status: 200,
        targetType: 'file',
        targetId: 'file-9',
        targetName: 'late.txt',
        details: expect.objectContaining({ tokenId: 'token-read' }),
      }),
    ])
    expect(events[0].details?.durationMs).toBeGreaterThanOrEqual(35)
    // The client still gets the whole answer, as the handler framed it.
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect((await message(response)).result).toEqual({
      content: [{ type: 'text', text: 'Not allowed' }],
      isError: true,
    })
  })

  it.each([
    [
      'a tool result marked as an error',
      { jsonrpc: '2.0', id: 1, result: { content: [], isError: true } },
    ],
    [
      'a protocol error',
      { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid' } },
    ],
  ])(
    'records a tool call answered with %s as a failure, and the same answer to another request not at all',
    async (_what, answer) => {
      for (const headers of [
        EVENT_STREAM,
        { 'content-type': 'application/json' },
      ]) {
        handler.fetch = async () =>
          new Response(
            headers === EVENT_STREAM ? sse(answer) : JSON.stringify(answer),
            { status: 200, headers }
          )
        events.length = 0
        await (await POST(request(toolCall('search_files')))).text()
        expect(await recorded()).toEqual([
          expect.objectContaining({
            action: 'mcp.search_files',
            outcome: 'failure',
            status: 200,
          }),
        ])

        // Not a tool call: passed through unread, and a 200 is not recorded.
        events.length = 0
        const other = await POST(request(rpc('tools/list')))
        expect(other.status).toBe(200)
        expect(await message(other)).toEqual(answer)
        expect(await recorded()).toEqual([])
      }
    }
  )

  it('leaves the outcome a tool set alone, whatever the answer says', async () => {
    handler.fetch = async () => {
      setAuditOutcome('denied')
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [], isError: true },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    await POST(request(toolCall('search_files')))
    expect(events).toEqual([
      expect.objectContaining({
        action: 'mcp.search_files',
        outcome: 'denied',
      }),
    ])
  })

  it('records a tool call whose answer reports no failure as a success', async () => {
    handler.fetch = async () =>
      new Response(
        sse({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: '{}' }] },
        }),
        { status: 200, headers: EVENT_STREAM }
      )
    await (await POST(request(toolCall('search_files')))).text()
    expect(await recorded()).toEqual([
      expect.objectContaining({
        action: 'mcp.search_files',
        outcome: 'success',
      }),
    ])
  })
})

describe('preflight', () => {
  const preflightRequest = (origin: string, method = 'POST') =>
    request(undefined, {
      method: 'OPTIONS',
      token: null,
      origin,
      headers: {
        'access-control-request-method': method,
        'access-control-request-headers':
          'authorization, content-type, mcp-protocol-version',
      },
    })

  it('tells an allowed origin it may POST with the MCP headers, before any authentication', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = await OPTIONS(preflightRequest(SITE))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(response.headers.get('access-control-allow-methods')).toBe('POST')
    expect(
      response.headers
        .get('access-control-allow-headers')
        ?.split(', ')
        .map((name) => name.toLowerCase())
    ).toEqual([
      'authorization',
      'content-type',
      'accept',
      'mcp-protocol-version',
      'mcp-method',
      'mcp-name',
      'mcp-session-id',
    ])
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('vary')).toBe('Origin')
    // The credential is a header the page sends, never a cookie.
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
    servedNothing()
  })

  it('answers * when every origin is allowed', async () => {
    vi.stubEnv(CORS_ENV, '*')
    const response = await OPTIONS(preflightRequest('https://any.example'))
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toBe('POST')
  })

  it.each([
    ['an origin that is not listed', 'https://evil.example', SITE],
    ['any origin while FLARE_CORS_ORIGINS is unset', SITE, ''],
  ])('says nothing about MCP to %s', async (_what, origin, cors) => {
    vi.stubEnv(CORS_ENV, cors)
    const response = await OPTIONS(preflightRequest(origin))
    expect(response.status).toBe(204)
    for (const header of [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-max-age',
    ])
      expect(response.headers.has(header), header).toBe(false)
  })

  it.each(['GET', 'DELETE', 'PUT'])(
    'does not allow another site to %s',
    async (method) => {
      vi.stubEnv(CORS_ENV, '*')
      const response = await OPTIONS(preflightRequest(SITE, method))
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
    }
  )
})

describe('answers to an allowed origin', () => {
  it('can be read by the page, with the challenge header exposed', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = await POST(
      request(toolCall('search_files'), { origin: SITE })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(
      response.headers.get('access-control-expose-headers')?.split(', ')
    ).toContain('WWW-Authenticate')
    expect(response.headers.get('vary')).toMatch(/Origin/)
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
  })

  it('lets the page read a 401 and its challenge', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = await POST(
      request(rpc('tools/list'), { origin: SITE, token: null })
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(response.headers.get('access-control-expose-headers')).toContain(
      'WWW-Authenticate'
    )
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="Flare MCP"'
    )
  })

  it('answers * when every origin is allowed', async () => {
    vi.stubEnv(CORS_ENV, '*')
    const response = await POST(
      request(rpc('tools/list'), { origin: 'https://any.example' })
    )
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('carry no CORS headers for a request without an Origin', async () => {
    vi.stubEnv(CORS_ENV, SITE)
    const response = await POST(request(rpc('tools/list')))
    expect(response.status).toBe(200)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
  })

  it("carry no CORS headers for Flare's own origin while FLARE_CORS_ORIGINS is unset", async () => {
    const response = await POST(request(rpc('tools/list'), { origin: APP }))
    expect(response.status).toBe(200)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
  })
})
