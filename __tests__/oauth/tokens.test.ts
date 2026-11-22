import {
  POST as revoke,
  OPTIONS as revokePreflight,
} from '@/app/api/oauth/revoke/route'
import {
  POST as token,
  OPTIONS as tokenPreflight,
} from '@/app/api/oauth/token/route'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AuditInput,
  auditSettled,
  configureAuditWriter,
} from '@/lib/audit'
import { DEFAULT_CONFIG } from '@/lib/config'
import { hashApiToken } from '@/lib/integrations/tokens'
import { loggers } from '@/lib/logger'
import { PAIRS_PER_HOUR } from '@/lib/oauth/constants'

const db = await vi.hoisted(async () =>
  (await import('./fake-database')).fakeDatabase()
)
const mocks = vi.hoisted(() => ({ config: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/database/prisma', () => ({ prisma: db.client }))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
// The token endpoints read no cookie; these prove nothing asks.
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))

const APP = 'https://files.example.com'
const RESOURCE = `${APP}/api/mcp`
const CLIENT = `flc_${'c'.repeat(43)}`
const OTHER_CLIENT = `flc_${'o'.repeat(43)}`
const UNKNOWN_CLIENT = `flc_${'u'.repeat(43)}`
const REDIRECT = 'http://localhost:53124/callback'
const VERIFIER = 'v'.repeat(64)
const CODE = 'authorization-code-of-43-characters-000000a'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const events: Partial<AuditInput>[] = []
let enabled = true

beforeEach(() => {
  vi.clearAllMocks()
  db.reset()
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
  db.tables.users.push(
    { id: 'user-alex', name: 'Alex', sessionVersion: 3 },
    { id: 'user-sam', name: 'Sam', sessionVersion: 1 }
  )
  db.tables.clients.push(
    { id: CLIENT, name: 'Claude Code (flare)', redirectUris: [REDIRECT] },
    { id: OTHER_CLIENT, name: 'Another client', redirectUris: [REDIRECT] }
  )
})
afterEach(async () => {
  await auditSettled()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

type Fields = Record<string, string | undefined>
const formBody = (fields: Fields) => {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(fields))
    if (value !== undefined) body.set(name, value)
  return body.toString()
}
const post = (
  handler: typeof token,
  path: string,
  body: string,
  headers: Record<string, string> = {}
) =>
  handler(
    new Request(`${APP}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body,
    })
  )
const tokenRequest = (fields: Fields, headers?: Record<string, string>) =>
  post(token, '/api/oauth/token', formBody(fields), headers)
const revokeRequest = (fields: Fields, headers?: Record<string, string>) =>
  post(revoke, '/api/oauth/revoke', formBody(fields), headers)

/** A code as the consent decision stores it. */
function issueCode(overrides: Record<string, unknown> = {}, code = CODE) {
  db.tables.codes.push({
    hash: hashApiToken(code),
    clientId: CLIENT,
    userId: 'user-alex',
    redirectUri: REDIRECT,
    codeChallenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    resource: RESOURCE,
    scopes: ['files:read', 'files:content', 'urls:read'],
    // The account's session version when the person approved.
    sessionVersion: 3,
    expiresAt: new Date(Date.now() + MINUTE),
    usedAt: null,
    connectionId: null,
    createdAt: new Date(),
    ...overrides,
  })
  return code
}
const codeGrant = (overrides: Fields = {}): Fields => ({
  grant_type: 'authorization_code',
  client_id: CLIENT,
  code: CODE,
  redirect_uri: REDIRECT,
  code_verifier: VERIFIER,
  ...overrides,
})
const refreshGrant = (refresh_token: string, overrides: Fields = {}) => ({
  grant_type: 'refresh_token',
  client_id: CLIENT,
  refresh_token,
  ...overrides,
})

type Pair = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}
/** Signs in: a code, redeemed. */
async function connect(
  scopes = ['files:read', 'files:content', 'urls:read'],
  code = CODE
): Promise<Pair> {
  issueCode({ scopes }, code)
  const response = await tokenRequest(codeGrant({ code }))
  expect(response.status).toBe(200)
  return response.json()
}
async function refreshed(pair: Pair, overrides: Fields = {}): Promise<Pair> {
  const response = await tokenRequest(
    refreshGrant(pair.refresh_token, overrides)
  )
  expect(response.status).toBe(200)
  return response.json()
}
const rowOf = (pair: Pair) =>
  db.tables.tokens.find(
    (row) => row.refreshHash === hashApiToken(pair.refresh_token)
  )!
const onlyConnection = () => {
  expect(db.tables.connections).toHaveLength(1)
  return db.tables.connections[0]
}
/** Moves a rotated token's rotation into the past. */
const age = (pair: Pair, seconds: number) => {
  rowOf(pair).rotatedAt = new Date(Date.now() - seconds * 1000)
}

async function expectError(
  response: Response,
  error: string,
  status = 400
): Promise<string> {
  expect(response.status).toBe(status)
  const body = await response.json()
  expect(body).toEqual({ error, error_description: expect.any(String) })
  expectUncached(response)
  return body.error_description
}
function expectUncached(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('pragma')).toBe('no-cache')
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  expect(response.headers.has('access-control-allow-credentials')).toBe(false)
}

describe('POST /api/oauth/token: the request', () => {
  it('answers 404 while the MCP server is off, and reads nothing', async () => {
    enabled = false
    issueCode()
    for (const response of [
      await tokenRequest(codeGrant()),
      await revokeRequest({ token: 'fla_anything' }),
      await tokenPreflight(),
      await revokePreflight(),
    ]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Not found' })
    }
    expect(db.calls).toEqual([])
    expect(db.tables.codes[0].usedAt).toBeNull()
    await auditSettled()
    expect(events).toEqual([])
  })

  it('answers a preflight for a form post from any site', async () => {
    for (const preflight of [tokenPreflight, revokePreflight]) {
      const response = await preflight()
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'POST, OPTIONS'
      )
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Content-Type, Authorization'
      )
    }
  })

  it.each([
    ['JSON', 'application/json', JSON.stringify(codeGrant())],
    ['plain text', 'text/plain', formBody(codeGrant())],
    [
      'a multipart form',
      'multipart/form-data; boundary=x',
      formBody(codeGrant()),
    ],
  ])(
    'refuses %s: the parameters are form-encoded',
    async (_what, type, body) => {
      issueCode()
      const response = await post(token, '/api/oauth/token', body, {
        'content-type': type,
      })
      expect(await expectError(response, 'invalid_request')).toMatch(
        /x-www-form-urlencoded/
      )
      expect(db.tables.codes[0].usedAt).toBeNull()
    }
  )

  it('accepts a charset on the content type', async () => {
    issueCode()
    const response = await tokenRequest(codeGrant(), {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    })
    expect(response.status).toBe(200)
  })

  it.each([
    'client_id',
    'code',
    'code_verifier',
    'redirect_uri',
    'grant_type',
    'resource',
  ])(
    'refuses a %s sent twice, which two readers could read differently',
    async (name) => {
      issueCode()
      const body = `${formBody(codeGrant({ resource: RESOURCE }))}&${name}=second`
      const response = await post(token, '/api/oauth/token', body)
      expect(await expectError(response, 'invalid_request')).toMatch(
        /more than once/
      )
      expect(db.tables.codes[0].usedAt).toBeNull()
    }
  )

  it.each([
    ['no grant_type', undefined],
    ['the password grant', 'password'],
    ['client credentials', 'client_credentials'],
    ['the implicit grant', 'implicit'],
    ['a device code', 'urn:ietf:params:oauth:grant-type:device_code'],
    ['a grant in another case', 'Authorization_Code'],
  ])('refuses %s', async (_what, grant_type) => {
    issueCode()
    await expectError(
      await tokenRequest(codeGrant({ grant_type })),
      'unsupported_grant_type'
    )
    expect(db.calls).toEqual([])
  })

  it('refuses a body over 16 KB', async () => {
    const response = await tokenRequest(
      codeGrant({ padding: 'x'.repeat(17 * 1024) })
    )
    await expectError(response, 'invalid_request', 413)
  })

  it('reads no cookie, session or Authorization header', async () => {
    issueCode()
    const response = await tokenRequest(codeGrant(), {
      cookie: 'next-auth.session-token=an-administrator',
      authorization: 'Basic Y2xpZW50OnNlY3JldA==',
      origin: 'https://claude.ai',
    })
    expect(response.status).toBe(200)
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('ignores a client secret: every client is a public client', async () => {
    issueCode()
    expect(
      (await tokenRequest(codeGrant({ client_secret: 'made-up' }))).status
    ).toBe(200)
  })

  it('answers server_error without detail when the database fails', async () => {
    const logged = vi
      .spyOn(loggers.api, 'error')
      .mockImplementation(() => loggers.api)
    issueCode()
    db.state.failing = true
    const response = await tokenRequest(codeGrant())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'server_error' })
    expectUncached(response)
    expect(logged).toHaveBeenCalled()
  })
})

describe('redeeming an authorization code', () => {
  it('answers a token pair and creates the connection it belongs to', async () => {
    issueCode()
    const response = await tokenRequest(codeGrant({ resource: RESOURCE }))
    expect(response.status).toBe(200)
    expectUncached(response)
    const pair: Pair = await response.json()
    expect(pair).toEqual({
      access_token: expect.stringMatching(/^fla_[A-Za-z0-9_-]{43}$/),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^flf_[A-Za-z0-9_-]{43}$/),
      scope: 'files:read files:content urls:read',
    })
    expect(onlyConnection()).toMatchObject({
      userId: 'user-alex',
      clientId: CLIENT,
      clientName: 'Claude Code (flare)',
      redirectUri: REDIRECT,
      scopes: ['files:read', 'files:content', 'urls:read'],
      revokedAt: null,
    })
    expect(db.tables.tokens).toHaveLength(1)
    const [row] = db.tables.tokens
    expect(row).toMatchObject({
      connectionId: onlyConnection().id,
      accessHash: hashApiToken(pair.access_token),
      refreshHash: hashApiToken(pair.refresh_token),
      narrowed: false,
      scopes: [],
      parentId: null,
      rotatedAt: null,
    })
    const now = Date.now()
    // An hour, and ninety days.
    expect((row.accessExpiresAt as Date).getTime() - now).toBeGreaterThan(
      59 * MINUTE
    )
    expect((row.accessExpiresAt as Date).getTime() - now).toBeLessThanOrEqual(
      60 * MINUTE
    )
    expect((row.refreshExpiresAt as Date).getTime() - now).toBeGreaterThan(
      90 * DAY - MINUTE
    )
    expect((row.refreshExpiresAt as Date).getTime() - now).toBeLessThanOrEqual(
      90 * DAY
    )
  })

  it('stores only digests: no token and no code is in the database', async () => {
    const pair = await connect()
    const stored = JSON.stringify(db.tables)
    expect(stored).not.toContain(pair.access_token)
    expect(stored).not.toContain(pair.refresh_token)
    expect(stored).not.toContain(CODE)
    expect(stored).not.toContain(VERIFIER)
  })

  it('marks the code used and records the connection it made', async () => {
    await connect()
    expect(db.tables.codes[0]).toMatchObject({
      usedAt: expect.any(Date),
      connectionId: onlyConnection().id,
    })
  })

  it('does it all in one transaction that opens with the account lock', async () => {
    await connect()
    expect(db.calls.filter((call) => call === 'transaction')).toHaveLength(1)
    const inside = db.calls.slice(db.calls.indexOf('transaction') + 1)
    expect(inside.slice(0, 2)).toEqual(['lock', 'oAuthCode.updateMany'])
    expect(inside).toEqual(
      expect.arrayContaining([
        'agentConnection.create',
        'agentToken.create',
        'oAuthCode.update',
      ])
    )
  })

  it.each(['client_id', 'code', 'redirect_uri', 'code_verifier'])(
    'needs %s',
    async (name) => {
      issueCode()
      expect(
        await expectError(
          await tokenRequest(codeGrant({ [name]: undefined })),
          name === 'client_id' ? 'invalid_request' : 'invalid_request'
        )
      ).toContain(name)
      expect(db.tables.codes[0].usedAt).toBeNull()
      expect(db.tables.connections).toEqual([])
    }
  )

  it('refuses a wrong verifier, and the code is used up by the attempt', async () => {
    issueCode()
    await expectError(
      await tokenRequest(codeGrant({ code_verifier: 'w'.repeat(64) })),
      'invalid_grant'
    )
    expect(db.tables.connections).toEqual([])
    expect(db.tables.tokens).toEqual([])
    // Nobody gets a second guess, not even with the right verifier.
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(db.tables.connections).toEqual([])
  })

  it.each([
    [
      'the challenge itself',
      createHash('sha256').update(VERIFIER).digest('base64url'),
    ],
    ['the verifier with a character added', `${VERIFIER}v`],
    ['the verifier in another case', VERIFIER.toUpperCase()],
  ])('refuses %s as the verifier', async (_what, code_verifier) => {
    issueCode()
    await expectError(
      await tokenRequest(codeGrant({ code_verifier })),
      'invalid_grant'
    )
    expect(db.tables.connections).toEqual([])
  })

  it.each([
    ['too short', 'v'.repeat(42)],
    ['too long', 'v'.repeat(129)],
    ['with characters a verifier cannot hold', `${'v'.repeat(50)} +/=`],
  ])(
    'refuses a verifier that is %s before using the code up',
    async (_what, code_verifier) => {
      issueCode()
      await expectError(
        await tokenRequest(codeGrant({ code_verifier })),
        'invalid_request'
      )
      expect(db.tables.codes[0].usedAt).toBeNull()
      expect((await tokenRequest(codeGrant())).status).toBe(200)
    }
  )

  it('refuses a plain challenge stored by mistake: the verifier never equals it', async () => {
    issueCode({ codeChallenge: VERIFIER })
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
  })

  it('refuses another registered client, and uses the code up', async () => {
    issueCode()
    await expectError(
      await tokenRequest(codeGrant({ client_id: OTHER_CLIENT })),
      'invalid_grant'
    )
    expect(db.tables.connections).toEqual([])
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
  })

  it.each([
    ['a client nobody registered', UNKNOWN_CLIENT],
    ['a client_id of another shape', 'https://client.example/metadata.json'],
  ])(
    'answers invalid_client for %s, and leaves the code alone',
    async (_what, client_id) => {
      issueCode()
      await expectError(
        await tokenRequest(codeGrant({ client_id })),
        'invalid_client'
      )
      expect(db.tables.codes[0].usedAt).toBeNull()
    }
  )

  it.each([
    ['another port', 'http://localhost:53125/callback'],
    ['another path', 'http://localhost:53124/other'],
    ['another host', 'http://127.0.0.1:53124/callback'],
    ['an added query', `${REDIRECT}?x=1`],
    ['a trailing slash', `${REDIRECT}/`],
    ['another site', 'https://evil.example/callback'],
  ])(
    'refuses %s as the redirect address: it must repeat the one approved',
    async (_what, redirect_uri) => {
      issueCode()
      await expectError(
        await tokenRequest(codeGrant({ redirect_uri })),
        'invalid_grant'
      )
      expect(db.tables.connections).toEqual([])
    }
  )

  it.each([
    ['another resource', 'https://other.example/api/mcp'],
    ['the site root', APP],
    ['an empty resource', ''],
  ])(
    'answers invalid_target for %s, before using the code up',
    async (_what, resource) => {
      issueCode()
      await expectError(
        await tokenRequest(codeGrant({ resource })),
        'invalid_target'
      )
      expect(db.tables.codes[0].usedAt).toBeNull()
    }
  )

  it.each([
    ['no resource', undefined],
    ['the MCP endpoint', RESOURCE],
    ['the MCP endpoint with a trailing slash', `${RESOURCE}/`],
  ])('accepts %s', async (_what, resource) => {
    issueCode()
    expect((await tokenRequest(codeGrant({ resource }))).status).toBe(200)
  })

  it('refuses a code issued for another resource than the one named now', async () => {
    issueCode({ resource: 'https://old.example/api/mcp' })
    await expectError(
      await tokenRequest(codeGrant({ resource: RESOURCE })),
      'invalid_grant'
    )
  })

  it('refuses a code approved under a session version the account has left', async () => {
    // Signing out everywhere deletes the account's codes. Should one outlive
    // that, it is still of no use: the account has moved on.
    issueCode({ sessionVersion: 2 })
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(db.tables.connections).toEqual([])
    expect(db.tables.tokens).toEqual([])
    // Used up by the attempt, like any code that fails a check.
    expect(db.tables.codes[0].usedAt).toBeInstanceOf(Date)
  })

  it('reads that version under the account lock, after the code is claimed', async () => {
    issueCode()
    // Signed out everywhere between the approval and this request.
    db.tables.users[0].sessionVersion = 4
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(db.tables.connections).toEqual([])
    const inside = db.calls.slice(db.calls.indexOf('transaction') + 1)
    expect(inside.slice(0, 3)).toEqual([
      'lock',
      'oAuthCode.updateMany',
      'oAuthCode.findUnique',
    ])
  })

  it('refuses an expired code', async () => {
    issueCode({ expiresAt: new Date(Date.now() - 1000) })
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(db.tables.connections).toEqual([])
    expect(db.tables.codes[0].usedAt).toBeNull()
  })

  it('refuses a code nobody issued', async () => {
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(db.calls).not.toContain('transaction')
  })

  it('refuses a code presented again, and ends the connection its first use made', async () => {
    const pair = await connect()
    const connection = onlyConnection()
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(connection).toMatchObject({
      revokedAt: expect.any(Date),
      revokedReason: 'code-reuse',
    })
    // Every pair is gone, so nothing the first use was given still works.
    expect(db.tables.tokens).toEqual([])
    await expectError(
      await tokenRequest(refreshGrant(pair.refresh_token)),
      'invalid_grant'
    )
    expect(db.tables.connections).toHaveLength(1)
  })

  it('ends the connection even when the second presenter gets everything else wrong', async () => {
    await connect()
    await expectError(
      await tokenRequest(
        codeGrant({
          client_id: OTHER_CLIENT,
          code_verifier: 'w'.repeat(64),
          redirect_uri: 'https://evil.example/cb',
        })
      ),
      'invalid_grant'
    )
    expect(onlyConnection().revokedReason).toBe('code-reuse')
  })

  it('ends only the connection that code made', async () => {
    await connect(['files:read'], 'first-code-of-43-characters-000000000000001')
    await connect(['files:read'], 'second-code-of-43-characters-00000000000002')
    await tokenRequest(
      codeGrant({ code: 'first-code-of-43-characters-000000000000001' })
    )
    expect(db.tables.connections.map((row) => row.revokedReason)).toEqual([
      'code-reuse',
      null,
    ])
    expect(db.tables.tokens).toHaveLength(1)
  })

  it('refuses the fifty-first connection of an account, and says why', async () => {
    for (let index = 0; index < 50; index++) {
      db.tables.connections.push({
        id: `existing-${index}`,
        userId: 'user-alex',
        revokedAt: null,
      })
      db.tables.tokens.push({
        id: `existing-pair-${index}`,
        connectionId: `existing-${index}`,
        refreshExpiresAt: new Date(Date.now() + DAY),
      })
    }
    issueCode()
    expect(
      await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    ).toMatch(/already has 50 connected agents/)
    expect(db.tables.connections).toHaveLength(50)
  })

  it('does not count connections that ended or ran out, or another account', async () => {
    for (let index = 0; index < 50; index++) {
      db.tables.connections.push({
        id: `ended-${index}`,
        userId: 'user-alex',
        revokedAt: index % 2 ? new Date() : null,
      })
      db.tables.tokens.push({
        id: `ended-pair-${index}`,
        connectionId: `ended-${index}`,
        // The live half has only an expired refresh token left.
        refreshExpiresAt: new Date(Date.now() + (index % 2 ? DAY : -DAY)),
      })
      db.tables.connections.push({
        id: `sam-${index}`,
        userId: 'user-sam',
        revokedAt: null,
      })
      db.tables.tokens.push({
        id: `sam-pair-${index}`,
        connectionId: `sam-${index}`,
        refreshExpiresAt: new Date(Date.now() + DAY),
      })
    }
    issueCode()
    expect((await tokenRequest(codeGrant())).status).toBe(200)
  })

  it('grants nothing a sign-in cannot grant, whatever the code row holds', async () => {
    const pair = await connect(['files:read', 'mcp', 'admin:everything'])
    expect(pair.scope).toBe('files:read')
    expect(onlyConnection().scopes).toEqual(['files:read'])
  })

  describe('the audit log', () => {
    it('records the account as actor and the new connection as target', async () => {
      const pair = await connect()
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.token',
          category: 'authentication',
          outcome: 'success',
          status: 200,
          route: '/api/oauth/token',
          actorId: 'user-alex',
          actorName: 'Alex',
          targetType: 'agent_connection',
          targetId: onlyConnection().id,
          targetName: 'Claude Code (flare)',
        }),
      ])
      const logged = JSON.stringify(events)
      for (const secret of [
        pair.access_token,
        pair.refresh_token,
        CODE,
        VERIFIER,
        hashApiToken(pair.access_token),
      ])
        expect(logged).not.toContain(secret)
    })

    it('records a refused code as a failure by nobody', async () => {
      issueCode()
      await tokenRequest(codeGrant({ code_verifier: 'w'.repeat(64) }))
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.token',
          outcome: 'failure',
          status: 400,
          actorName: 'Anonymous',
        }),
      ])
      expect(events[0].actorId).toBeUndefined()
      expect(JSON.stringify(events)).not.toContain('w'.repeat(64))
    })

    it('records a code that came back as a denial, with the connection it ended', async () => {
      await connect()
      events.length = 0
      await tokenRequest(codeGrant())
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.token',
          outcome: 'denied',
          status: 400,
          actorName: 'Anonymous',
          targetType: 'agent_connection',
          targetId: onlyConnection().id,
          targetName: 'Claude Code (flare)',
        }),
      ])
    })
  })
})

/** Saved settings with administration through MCP on or off, as a transaction reads them. */
function administration(on: boolean) {
  const config = structuredClone(DEFAULT_CONFIG)
  config.settings.general.mcp.enabled = true
  config.settings.general.mcp.administration = on
  db.state.settings = config
}

describe('redeeming a code that grants an administration scope', () => {
  it('takes the settings lock before the account row, and grants the scope while it is on', async () => {
    administration(true)
    db.calls.length = 0
    const pair = await connect(['files:read', 'admin:read'])
    expect(pair.scope).toBe('files:read admin:read')
    expect(onlyConnection().scopes).toEqual(['files:read', 'admin:read'])
    const inside = db.calls.slice(db.calls.indexOf('transaction') + 1)
    expect(inside.slice(0, 3)).toEqual([
      'settingsLock',
      'config.findUnique',
      'lock',
    ])
  })

  it('makes the connection without it once administration was turned off, and says so in scope', async () => {
    administration(false)
    const pair = await connect(['files:read', 'admin:read', 'admin:users'])
    expect(pair.scope).toBe('files:read')
    expect(onlyConnection().scopes).toEqual(['files:read'])
  })

  it('refuses a code that granted nothing else, and uses it up', async () => {
    administration(false)
    issueCode({ scopes: ['admin:read'] })
    await expectError(await tokenRequest(codeGrant()), 'invalid_grant')
    expect(db.tables.connections).toEqual([])
    expect(db.tables.codes[0].usedAt).toBeInstanceOf(Date)
  })

  it('takes no settings lock for a code without one', async () => {
    db.calls.length = 0
    await connect()
    expect(db.calls).not.toContain('settingsLock')
    expect(db.calls).not.toContain('config.findUnique')
  })
})

describe('refreshing', () => {
  it('ends a connection with an administration scope 30 days after it was authorized, however recently used', async () => {
    const DAY = 86_400_000
    administration(true)
    let pair = await connect(['files:read', 'admin:read'])
    onlyConnection().createdAt = new Date(Date.now() - 30 * DAY + 60_000)
    pair = await refreshed(pair)
    expect(pair.scope).toBe('files:read admin:read')
    onlyConnection().createdAt = new Date(Date.now() - 30 * DAY - 1000)
    onlyConnection().lastUsedAt = new Date()
    await expectError(
      await tokenRequest(refreshGrant(pair.refresh_token)),
      'invalid_grant'
    )
    // The refresh token was not used up by the refusal, and still never works.
    expect(rowOf(pair).rotatedAt).toBeNull()
  })

  it('keeps a connection without one working past 30 days', async () => {
    const pair = await connect(['files:read', 'invites:write'])
    onlyConnection().createdAt = new Date(Date.now() - 400 * 86_400_000)
    await refreshed(pair)
  })

  it('rotates: a new pair, and the old refresh token marked used', async () => {
    const first = await connect()
    const response = await tokenRequest(refreshGrant(first.refresh_token))
    expect(response.status).toBe(200)
    expectUncached(response)
    const second: Pair = await response.json()
    expect(second).toEqual({
      access_token: expect.stringMatching(/^fla_[A-Za-z0-9_-]{43}$/),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^flf_[A-Za-z0-9_-]{43}$/),
      scope: 'files:read files:content urls:read',
    })
    expect(second.access_token).not.toBe(first.access_token)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect(rowOf(first).rotatedAt).toBeInstanceOf(Date)
    expect(rowOf(second)).toMatchObject({
      parentId: rowOf(first).id,
      rotatedAt: null,
      connectionId: onlyConnection().id,
      narrowed: false,
    })
    expect(db.tables.connections).toHaveLength(1)
  })

  it('keeps rotating down the chain', async () => {
    let pair = await connect()
    for (let index = 0; index < 4; index++) pair = await refreshed(pair)
    expect(db.tables.tokens).toHaveLength(5)
    expect(
      db.tables.tokens.filter((row) => row.rotatedAt === null)
    ).toHaveLength(1)
  })

  it('takes turns on the connection, and claims the token row inside the transaction', async () => {
    const first = await connect()
    db.calls.length = 0
    await refreshed(first)
    expect(db.calls.filter((call) => call === 'transaction')).toHaveLength(1)
    const inside = db.calls.slice(db.calls.indexOf('transaction') + 1)
    expect(inside[0]).toBe('lock')
    expect(inside).toEqual(
      expect.arrayContaining(['agentToken.updateMany', 'agentToken.create'])
    )
  })

  describe('a refresh token used again within a minute', () => {
    it('gets another successor, and both successors work', async () => {
      const first = await connect()
      const second = await refreshed(first)
      age(first, 59)
      const third = await refreshed(first)
      expect(third.refresh_token).not.toBe(second.refresh_token)
      expect(third.access_token).not.toBe(second.access_token)
      expect(rowOf(third).parentId).toBe(rowOf(first).id)
      expect(onlyConnection().revokedAt).toBeNull()
      // Each window now holds a pair it can go on refreshing.
      expect(rowOf(second).rotatedAt).toBeNull()
      expect(rowOf(third).rotatedAt).toBeNull()
      await refreshed(second)
      await refreshed(third)
      expect(onlyConnection().revokedAt).toBeNull()
    })

    it('does not move the moment of the first rotation', async () => {
      const first = await connect()
      await refreshed(first)
      age(first, 50)
      const rotatedAt = rowOf(first).rotatedAt
      await refreshed(first)
      expect(rowOf(first).rotatedAt).toBe(rotatedAt)
    })

    it('gets five successors in all, and the sixth is refused without ending anything', async () => {
      const first = await connect()
      for (let index = 0; index < 5; index++) await refreshed(first)
      expect(
        db.tables.tokens.filter((row) => row.parentId === rowOf(first).id)
      ).toHaveLength(5)
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token)),
        'invalid_grant'
      )
      expect(
        db.tables.tokens.filter((row) => row.parentId === rowOf(first).id)
      ).toHaveLength(5)
      expect(onlyConnection().revokedAt).toBeNull()
      expect(db.tables.tokens).toHaveLength(6)
    })

    it('counts successors per refresh token, not per connection', async () => {
      const first = await connect()
      const second = await refreshed(first)
      for (let index = 0; index < 4; index++) await refreshed(first)
      // The second token has its own five.
      for (let index = 0; index < 5; index++) await refreshed(second)
      await expectError(
        await tokenRequest(refreshGrant(second.refresh_token)),
        'invalid_grant'
      )
    })
  })

  describe('a refresh token used again after a minute', () => {
    it('is a replay: the connection ends, with every pair it had', async () => {
      const first = await connect()
      const second = await refreshed(first)
      const third = await refreshed(second)
      age(first, 60)
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token)),
        'invalid_grant'
      )
      expect(onlyConnection()).toMatchObject({
        revokedAt: expect.any(Date),
        revokedReason: 'replay',
      })
      expect(db.tables.tokens).toEqual([])
      // The newest pair, which was never misused, is gone too.
      for (const pair of [second, third])
        await expectError(
          await tokenRequest(refreshGrant(pair.refresh_token)),
          'invalid_grant'
        )
    })

    it.each([61, 3600, 89 * 24 * 3600])(
      'is a replay %i seconds after the rotation',
      async (seconds) => {
        const first = await connect()
        await refreshed(first)
        age(first, seconds)
        await tokenRequest(refreshGrant(first.refresh_token))
        expect(onlyConnection().revokedReason).toBe('replay')
      }
    )

    it.each<[string, Fields]>([
      ['names another client', { client_id: OTHER_CLIENT }],
      ['asks for a scope it never held', { scope: 'files:delete' }],
      ['asks for the scopes it holds', { scope: 'files:read' }],
    ])('is a replay even when the request %s', async (_what, extra) => {
      const first = await connect()
      await refreshed(first)
      age(first, 120)
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token, extra)),
        'invalid_grant'
      )
      expect(onlyConnection().revokedReason).toBe('replay')
      expect(db.tables.tokens).toEqual([])
    })

    it('is a replay even after the old token itself expired', async () => {
      const first = await connect()
      const second = await refreshed(first)
      age(first, 3600)
      rowOf(first).refreshExpiresAt = new Date(Date.now() - 1000)
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token)),
        'invalid_grant'
      )
      expect(onlyConnection().revokedReason).toBe('replay')
      await expectError(
        await tokenRequest(refreshGrant(second.refresh_token)),
        'invalid_grant'
      )
    })

    it('is still inside the leeway one second before', async () => {
      const first = await connect()
      await refreshed(first)
      age(first, 58)
      await refreshed(first)
      expect(onlyConnection().revokedAt).toBeNull()
    })

    it('ends only its own connection', async () => {
      const first = await connect(
        ['files:read'],
        'first-code-of-43-characters-000000000000001'
      )
      await connect(
        ['files:read'],
        'second-code-of-43-characters-00000000000002'
      )
      await refreshed(first)
      age(first, 120)
      await tokenRequest(refreshGrant(first.refresh_token))
      expect(db.tables.connections.map((row) => row.revokedReason)).toEqual([
        'replay',
        null,
      ])
      expect(db.tables.tokens).toHaveLength(1)
    })

    it('is recorded as a denial with the connection as its target', async () => {
      const first = await connect()
      await refreshed(first)
      age(first, 120)
      events.length = 0
      await tokenRequest(refreshGrant(first.refresh_token))
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.token',
          category: 'authentication',
          outcome: 'denied',
          status: 400,
          targetType: 'agent_connection',
          targetId: onlyConnection().id,
          targetName: 'Claude Code (flare)',
        }),
      ])
      expect(JSON.stringify(events)).not.toContain(first.refresh_token)
    })
  })

  describe('a connection that refreshes in a loop', () => {
    /** Signs in and refreshes down the chain until the hour's pairs are used. */
    async function atTheLimit(): Promise<Pair> {
      let newest = await connect()
      for (let index = 1; index < PAIRS_PER_HOUR; index++)
        newest = await refreshed(newest)
      expect(db.tables.tokens).toHaveLength(PAIRS_PER_HOUR)
      return newest
    }
    /** Moves the first pair of the connection into the past. */
    const ageFirstPair = (minutes: number) => {
      db.tables.tokens[0].createdAt = new Date(Date.now() - minutes * MINUTE)
    }
    const overLimit = async (pair: Pair, extra: Fields = {}) => {
      const response = await tokenRequest(
        refreshGrant(pair.refresh_token, extra)
      )
      expect(await expectError(response, 'temporarily_unavailable', 429)).toBe(
        'This connection refreshed its tokens too often in the last hour. Try again later.'
      )
      return Number(response.headers.get('retry-after'))
    }

    it('is issued 30 pairs an hour, its first included, and then answered 429', async () => {
      expect(PAIRS_PER_HOUR).toBe(30)
      const newest = await atTheLimit()
      const retryAfter = await overLimit(newest)
      expect(retryAfter).toBeGreaterThan(3590)
      expect(retryAfter).toBeLessThanOrEqual(3600)
      // Nothing was issued and nothing was used up.
      expect(db.tables.tokens).toHaveLength(PAIRS_PER_HOUR)
      expect(rowOf(newest).rotatedAt).toBeNull()
      expect(onlyConnection().revokedAt).toBeNull()
    })

    it('says how long until the oldest pair of the hour is an hour old', async () => {
      const newest = await atTheLimit()
      ageFirstPair(59)
      const retryAfter = await overLimit(newest)
      expect(retryAfter).toBeGreaterThan(50)
      expect(retryAfter).toBeLessThanOrEqual(60)
    })

    it('takes the same refresh token once there is room', async () => {
      const newest = await atTheLimit()
      await overLimit(newest)
      ageFirstPair(61)
      const next = await refreshed(newest)
      expect(rowOf(next).parentId).toBe(rowOf(newest).id)
      // And that used the room up again.
      await overLimit(next)
    })

    describe('an answer that was lost at the limit', () => {
      /** The refresh that issued the hour's last pair, whose answer never arrived. */
      async function lostAtTheLimit() {
        let newest = await connect()
        for (let index = 2; index < PAIRS_PER_HOUR; index++)
          newest = await refreshed(newest)
        // The client still holds `newest`; this answer is the one it lost.
        await refreshed(newest)
        expect(db.tables.tokens).toHaveLength(PAIRS_PER_HOUR)
        return newest
      }
      const successorsOf = (pair: Pair) =>
        db.tables.tokens.filter((row) => row.parentId === rowOf(pair).id)

      it('is asked for again with the same token, and answered, though the hour is used up', async () => {
        const held = await lostAtTheLimit()
        const again = await refreshed(held)
        expect(successorsOf(held)).toHaveLength(2)
        expect(onlyConnection().revokedAt).toBeNull()
        // The pair it got works, and is itself held to the hourly limit.
        expect(rowOf(again).rotatedAt).toBeNull()
        await overLimit(again)
      })

      it('is never told to wait: waiting would make the retry a replay', async () => {
        const held = await lostAtTheLimit()
        // Up to the five the leeway allows, each answered at once.
        for (let index = 0; index < 4; index++) await refreshed(held)
        expect(successorsOf(held)).toHaveLength(5)
        // Past them the answer is the leeway's own refusal, not the limit's.
        await expectError(
          await tokenRequest(refreshGrant(held.refresh_token)),
          'invalid_grant'
        )
        expect(onlyConnection().revokedAt).toBeNull()
      })

      it('is a replay after the minute, as below the limit', async () => {
        const held = await lostAtTheLimit()
        age(held, 61)
        await expectError(
          await tokenRequest(refreshGrant(held.refresh_token)),
          'invalid_grant'
        )
        expect(onlyConnection().revokedReason).toBe('replay')
      })
    })

    it('still ends the connection for an old token, limit or not', async () => {
      const first = await connect()
      let newest = await refreshed(first)
      for (let index = 2; index < PAIRS_PER_HOUR; index++)
        newest = await refreshed(newest)
      age(first, 120)
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token)),
        'invalid_grant'
      )
      expect(onlyConnection().revokedReason).toBe('replay')
      expect(db.tables.tokens).toEqual([])
    })

    it.each<[string, Fields, string]>([
      ['another client', { client_id: OTHER_CLIENT }, 'invalid_grant'],
      ['a scope it never held', { scope: 'files:delete' }, 'invalid_scope'],
    ])(
      'still refuses %s as it would below the limit',
      async (_what, extra, error) => {
        const newest = await atTheLimit()
        await expectError(
          await tokenRequest(refreshGrant(newest.refresh_token, extra)),
          error
        )
      }
    )

    it('counts each connection by itself', async () => {
      const other = await connect(
        ['files:read'],
        'second-code-of-43-characters-00000000000002'
      )
      let newest = await connect()
      for (let index = 1; index < PAIRS_PER_HOUR; index++)
        newest = await refreshed(newest)
      await overLimit(newest)
      await refreshed(other)
    })

    it('is recorded as a failure with status 429', async () => {
      const newest = await atTheLimit()
      events.length = 0
      await overLimit(newest)
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.token',
          category: 'authentication',
          outcome: 'failure',
          status: 429,
        }),
      ])
    })
  })

  describe('the client', () => {
    it('refuses another registered client, without using the token up', async () => {
      const first = await connect()
      await expectError(
        await tokenRequest(
          refreshGrant(first.refresh_token, { client_id: OTHER_CLIENT })
        ),
        'invalid_grant'
      )
      expect(rowOf(first).rotatedAt).toBeNull()
      expect(onlyConnection().revokedAt).toBeNull()
      expect(db.tables.tokens).toHaveLength(1)
      // The right client still can.
      await refreshed(first)
    })

    it('answers invalid_client for a client nobody registered', async () => {
      const first = await connect()
      await expectError(
        await tokenRequest(
          refreshGrant(first.refresh_token, { client_id: UNKNOWN_CLIENT })
        ),
        'invalid_client'
      )
      expect(rowOf(first).rotatedAt).toBeNull()
    })

    it('needs client_id and refresh_token', async () => {
      const first = await connect()
      for (const name of ['client_id', 'refresh_token'])
        expect(
          await expectError(
            await tokenRequest(
              refreshGrant(first.refresh_token, { [name]: undefined })
            ),
            'invalid_request'
          )
        ).toContain(name)
    })
  })

  describe('tokens that cannot be refreshed', () => {
    it.each([
      ['a token nobody issued', `flf_${'x'.repeat(43)}`],
      ['a value that is no refresh token', 'not-a-token'],
      ['a named API token', `flr_${'x'.repeat(43)}`],
    ])('refuses %s', async (_what, value) => {
      await connect()
      await expectError(
        await tokenRequest(refreshGrant(value)),
        'invalid_grant'
      )
      expect(db.tables.tokens).toHaveLength(1)
      expect(onlyConnection().revokedAt).toBeNull()
    })

    it('refuses an access token presented as a refresh token', async () => {
      const first = await connect()
      await expectError(
        await tokenRequest(refreshGrant(first.access_token)),
        'invalid_grant'
      )
      expect(rowOf(first).rotatedAt).toBeNull()
    })

    it('refuses a refresh token that expired, without calling it a replay', async () => {
      const first = await connect()
      rowOf(first).refreshExpiresAt = new Date(Date.now() - 1000)
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token)),
        'invalid_grant'
      )
      expect(onlyConnection().revokedAt).toBeNull()
      expect(db.tables.tokens).toHaveLength(1)
    })

    it('refuses a token of a connection that ended, even if its row were still there', async () => {
      const first = await connect()
      Object.assign(onlyConnection(), {
        revokedAt: new Date(),
        revokedReason: 'disconnected',
      })
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token)),
        'invalid_grant'
      )
      expect(db.tables.tokens).toHaveLength(1)
    })

    it('answers invalid_target for another resource, without using the token up', async () => {
      const first = await connect()
      await expectError(
        await tokenRequest(
          refreshGrant(first.refresh_token, {
            resource: 'https://other.example/api/mcp',
          })
        ),
        'invalid_target'
      )
      expect(rowOf(first).rotatedAt).toBeNull()
      await refreshed(first, { resource: `${RESOURCE}/` })
    })
  })

  describe('narrowing with scope', () => {
    it('narrows the successor to the set asked for', async () => {
      const first = await connect()
      const second = await refreshed(first, { scope: 'files:read' })
      expect(second.scope).toBe('files:read')
      expect(rowOf(second)).toMatchObject({
        narrowed: true,
        scopes: ['files:read'],
      })
      // The connection itself still holds what the person granted.
      expect(onlyConnection().scopes).toEqual([
        'files:read',
        'files:content',
        'urls:read',
      ])
    })

    it('keeps the narrower ceiling on every later refresh, and cannot be widened', async () => {
      const first = await connect()
      const second = await refreshed(first, { scope: 'files:read urls:read' })
      const third = await refreshed(second)
      expect(third.scope).toBe('files:read urls:read')
      expect(rowOf(third)).toMatchObject({
        narrowed: true,
        scopes: ['files:read', 'urls:read'],
      })
      await expectError(
        await tokenRequest(
          refreshGrant(third.refresh_token, {
            scope: 'files:read files:content urls:read',
          })
        ),
        'invalid_scope'
      )
      // It can be narrowed again.
      const fourth = await refreshed(third, { scope: 'urls:read' })
      expect(fourth.scope).toBe('urls:read')
      await expectError(
        await tokenRequest(
          refreshGrant(fourth.refresh_token, { scope: 'files:read' })
        ),
        'invalid_scope'
      )
    })

    it('does not use the token up when the scope is refused', async () => {
      const first = await connect()
      await expectError(
        await tokenRequest(
          refreshGrant(first.refresh_token, { scope: 'files:delete' })
        ),
        'invalid_scope'
      )
      expect(rowOf(first).rotatedAt).toBeNull()
      expect(db.tables.tokens).toHaveLength(1)
      await refreshed(first)
    })

    it.each([
      ['a scope the person never granted', 'files:read files:delete'],
      ['the marker for named tokens', 'files:read mcp'],
      ['a scope that does not exist', 'files:read admin:everything'],
      ['only scopes it does not hold', 'urls:write'],
    ])('refuses %s', async (_what, scope) => {
      const first = await connect()
      await expectError(
        await tokenRequest(refreshGrant(first.refresh_token, { scope })),
        'invalid_scope'
      )
    })

    it('narrows one pair only: the other window keeps the whole grant', async () => {
      const first = await connect()
      const narrow = await refreshed(first, { scope: 'files:read' })
      age(first, 10)
      const wide = await refreshed(first)
      expect(narrow.scope).toBe('files:read')
      expect(wide.scope).toBe('files:read files:content urls:read')
      expect(rowOf(wide).narrowed).toBe(false)
      // And each keeps what it has on its next refresh.
      expect((await refreshed(narrow)).scope).toBe('files:read')
      expect((await refreshed(wide)).scope).toBe(
        'files:read files:content urls:read'
      )
    })

    it('treats an empty scope as none sent', async () => {
      const first = await connect()
      const second = await refreshed(first, { scope: '' })
      expect(second.scope).toBe('files:read files:content urls:read')
      expect(rowOf(second).narrowed).toBe(false)
    })

    it('states the scope in catalog order, each scope once', async () => {
      const first = await connect()
      const second = await refreshed(first, {
        scope: 'urls:read files:read urls:read',
      })
      expect(second.scope).toBe('files:read urls:read')
    })
  })

  describe('a connection whose permissions were edited', () => {
    it('states the edited grant on the next refresh', async () => {
      const first = await connect()
      onlyConnection().scopes = ['files:read']
      expect((await refreshed(first)).scope).toBe('files:read')
    })

    it('cannot ask for a scope that was taken away', async () => {
      const first = await connect()
      onlyConnection().scopes = ['files:read']
      await expectError(
        await tokenRequest(
          refreshGrant(first.refresh_token, { scope: 'files:content' })
        ),
        'invalid_scope'
      )
    })

    it('gives an un-narrowed pair a scope that was added, and a narrowed pair nothing new', async () => {
      const first = await connect()
      const narrow = await refreshed(first, { scope: 'files:read' })
      age(first, 10)
      const wide = await refreshed(first)
      onlyConnection().scopes = [
        'files:upload',
        'files:read',
        'files:content',
        'urls:read',
      ]
      expect((await refreshed(wide)).scope).toBe(
        'files:upload files:read files:content urls:read'
      )
      expect((await refreshed(narrow)).scope).toBe('files:read')
    })

    it('states an empty scope when the pair and the grant no longer overlap', async () => {
      const first = await connect()
      const narrow = await refreshed(first, { scope: 'urls:read' })
      onlyConnection().scopes = ['files:read']
      expect((await refreshed(narrow)).scope).toBe('')
    })
  })

  describe('the audit log', () => {
    it('records nothing for a refresh that succeeded', async () => {
      const first = await connect()
      events.length = 0
      await refreshed(first)
      await auditSettled()
      expect(events).toEqual([])
    })

    it('records a refresh that was refused', async () => {
      await connect()
      events.length = 0
      await tokenRequest(refreshGrant(`flf_${'x'.repeat(43)}`))
      await auditSettled()
      expect(events).toEqual([
        expect.objectContaining({
          action: 'oauth.token',
          category: 'authentication',
          outcome: 'failure',
          status: 400,
        }),
      ])
      expect(JSON.stringify(events)).not.toContain('x'.repeat(43))
    })
  })
})

describe('POST /api/oauth/revoke', () => {
  const expectRevoked = (reason = 'revoked') => {
    expect(onlyConnection()).toMatchObject({
      revokedAt: expect.any(Date),
      revokedReason: reason,
    })
    expect(db.tables.tokens).toEqual([])
  }
  const expectOk = async (response: Response) => {
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expectUncached(response)
  }

  it('ends the connection a refresh token belongs to', async () => {
    const pair = await connect()
    await expectOk(await revokeRequest({ token: pair.refresh_token }))
    expectRevoked()
  })

  it('ends the connection an access token belongs to', async () => {
    const pair = await connect()
    await expectOk(await revokeRequest({ token: pair.access_token }))
    expectRevoked()
  })

  it('ends every pair of the connection, not only the one presented', async () => {
    const first = await connect()
    const second = await refreshed(first)
    await refreshed(second)
    expect(db.tables.tokens).toHaveLength(3)
    await expectOk(await revokeRequest({ token: second.access_token }))
    expectRevoked()
  })

  it.each([
    [
      'a refresh token that was already rotated',
      (pair: Pair) => pair.refresh_token,
    ],
    ['the access token issued with it', (pair: Pair) => pair.access_token],
  ])('accepts %s', async (_what, pick) => {
    const first = await connect()
    await refreshed(first)
    await expectOk(await revokeRequest({ token: pick(first) }))
    expectRevoked()
  })

  it('accepts an access token that expired', async () => {
    const pair = await connect()
    rowOf(pair).accessExpiresAt = new Date(Date.now() - 1000)
    await expectOk(await revokeRequest({ token: pair.access_token }))
    expectRevoked()
  })

  it('ignores the hint, and needs no client_id', async () => {
    const pair = await connect()
    await expectOk(
      await revokeRequest({
        token: pair.refresh_token,
        token_type_hint: 'access_token',
      })
    )
    expectRevoked()
  })

  it.each([
    ['a refresh token nobody issued', `flf_${'x'.repeat(43)}`],
    ['an access token nobody issued', `fla_${'x'.repeat(43)}`],
    ['a named API token', `flr_${'x'.repeat(43)}`],
    ['a client_id', CLIENT],
    ['some other text', 'not-a-token'],
  ])('answers 200 for %s, and ends nothing', async (_what, value) => {
    await connect()
    await expectOk(await revokeRequest({ token: value }))
    expect(onlyConnection().revokedAt).toBeNull()
    expect(db.tables.tokens).toHaveLength(1)
  })

  it('never looks up a value that is not one of its tokens', async () => {
    db.calls.length = 0
    await revokeRequest({ token: `flr_${'x'.repeat(43)}` })
    await revokeRequest({ token: 'legacy-upload-token' })
    expect(db.calls).toEqual([])
  })

  it('answers 200 again for a token it already revoked', async () => {
    const pair = await connect()
    await revokeRequest({ token: pair.refresh_token })
    await expectOk(await revokeRequest({ token: pair.refresh_token }))
    await expectOk(await revokeRequest({ token: pair.access_token }))
  })

  it('ends only the connection the token belongs to', async () => {
    const first = await connect(
      ['files:read'],
      'first-code-of-43-characters-000000000000001'
    )
    const second = await connect(
      ['files:read'],
      'second-code-of-43-characters-00000000000002'
    )
    await revokeRequest({ token: first.refresh_token })
    expect(db.tables.connections.map((row) => row.revokedReason)).toEqual([
      'revoked',
      null,
    ])
    await refreshed(second)
  })

  it('removes the transfer URLs the connection had', async () => {
    const pair = await connect()
    db.tables.transfers.push(
      { id: 't1', credential: `connection:${onlyConnection().id}` },
      { id: 't2', credential: 'connection:another' },
      { id: 't3', credential: 'token:token-1' }
    )
    await revokeRequest({ token: pair.access_token })
    expect(db.tables.transfers.map((row) => row.id)).toEqual(['t2', 't3'])
  })

  it('refuses a request without a token, and one that is not a form', async () => {
    await expectError(await revokeRequest({}), 'invalid_request')
    await expectError(await revokeRequest({ token: '' }), 'invalid_request')
    await expectError(
      await post(revoke, '/api/oauth/revoke', '{"token":"x"}', {
        'content-type': 'application/json',
      }),
      'invalid_request'
    )
  })

  it('reads no cookie', async () => {
    const pair = await connect()
    await revokeRequest(
      { token: pair.refresh_token },
      { cookie: 'next-auth.session-token=an-administrator' }
    )
    expect(mocks.session).not.toHaveBeenCalled()
  })

  it('records the revocation with the account and the connection, never the token', async () => {
    const pair = await connect()
    events.length = 0
    await revokeRequest({ token: pair.refresh_token })
    await auditSettled()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'oauth.revoke',
        category: 'authentication',
        outcome: 'success',
        status: 200,
        actorId: 'user-alex',
        actorName: 'Alex',
        targetType: 'agent_connection',
        targetId: onlyConnection().id,
        targetName: 'Claude Code (flare)',
      }),
    ])
    expect(JSON.stringify(events)).not.toContain(pair.refresh_token)
  })

  it('records a token it did not know with no actor and no target', async () => {
    await revokeRequest({ token: `flf_${'x'.repeat(43)}` })
    await auditSettled()
    expect(events).toEqual([
      expect.objectContaining({
        action: 'oauth.revoke',
        outcome: 'success',
        actorName: 'Anonymous',
      }),
    ])
    expect(events[0].targetId).toBeUndefined()
  })
})
