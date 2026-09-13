import type { User } from '@prisma/client'
import type { NextAuthOptions } from 'next-auth'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getAuthOptions } from '@/lib/auth'
import type { FlareConfig } from '@/lib/config'

vi.mock('@/lib/email/config', async () => {
  const { DEFAULT_EMAIL_CONFIG } = await import('@/lib/email/schema')
  return { getEmailConfig: async () => DEFAULT_EMAIL_CONFIG }
})

type StoredUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'name'
  | 'role'
  | 'sessionVersion'
  | 'image'
  | 'password'
  | 'emailVerified'
  | 'oidcSubject'
  | 'uploadToken'
  | 'urlId'
>
type UserWhere = Partial<
  Pick<StoredUser, 'id' | 'email' | 'oidcSubject' | 'urlId'>
>
type CreateUserData = Pick<StoredUser, 'urlId' | 'uploadToken'> &
  Partial<Omit<StoredUser, 'id' | 'sessionVersion'>>
type OidcSettings = FlareConfig['settings']['general']['oidc']

const db = vi.hoisted(() => {
  const oidc: OidcSettings = {
    enabled: true,
    issuer: '',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    buttonText: 'SSO',
    autoProvision: true,
    requireEmailVerified: true,
    enforceSso: false,
  }
  return {
    rows: [] as StoredUser[],
    oidc,
    create: vi.fn(),
    update: vi.fn(),
  }
})

// Storage is simulated; the application resolver, user creation, NextAuth
// callbacks, cookie handling, and OIDC discovery/token validation are real.
vi.mock('@/lib/database/prisma', () => {
  const user = {
    findUnique: vi.fn(async ({ where }: { where: UserWhere }) => {
      const row = db.rows.find((candidate) =>
        Object.entries(where).every(
          ([key, value]) => candidate[key as keyof UserWhere] === value
        )
      )
      return row ? { ...row } : null
    }),
    count: vi.fn(async () => db.rows.length),
    create: vi.fn(async ({ data }: { data: CreateUserData }) => {
      db.create(data)
      const row: StoredUser = {
        id: `user-${db.rows.length}`,
        email: data.email ?? null,
        name: data.name ?? null,
        role: data.role ?? 'USER',
        sessionVersion: 1,
        image: data.image ?? null,
        password: data.password ?? null,
        emailVerified: data.emailVerified ?? null,
        oidcSubject: data.oidcSubject ?? null,
        uploadToken: data.uploadToken,
        urlId: data.urlId,
      }
      db.rows.push(row)
      return { ...row }
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Partial<StoredUser>
      }) => {
        db.update(data)
        const row = db.rows.find((candidate) => candidate.id === where.id)
        if (!row) throw new Error(`Missing test user: ${where.id}`)
        Object.assign(row, data)
        return { ...row }
      }
    ),
  }
  return {
    prisma: {
      user,
      $transaction: async <T>(callback: (tx: { user: typeof user }) => T) =>
        callback({ user }),
    },
  }
})

vi.mock('@/lib/config', () => ({
  getConfig: async () => ({ settings: { general: { oidc: db.oidc } } }),
}))

type AuthAction = 'csrf' | 'signin' | 'callback' | 'session'
interface AuthResponse {
  body?: Record<string, unknown>
  redirect?: string
  cookies?: {
    name: string
    value: string
    options?: { maxAge?: number }
  }[]
}

// NextAuth 4 does not export its core entry point. Keep the internal dependency
// isolated here with the request/response subset this protocol harness uses.
const require = createRequire(import.meta.url)
const { AuthHandler } = require(
  join(dirname(require.resolve('next-auth')), 'core/index.js')
) as {
  AuthHandler: (input: {
    options: NextAuthOptions
    req: {
      action: AuthAction
      method: 'GET' | 'POST'
      providerId?: string
      body: Record<string, string>
      query: Record<string, string>
      cookies: Record<string, string>
      headers: Record<string, string>
    }
  }) => Promise<AuthResponse>
}

interface IdTokenClaims {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  iss?: string
  aud?: string
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256',
}
const callbackUrl = 'http://localhost:3000/dashboard'
const codes = new Map<string, string>()
let issuer: string
let claims: IdTokenClaims
let badSignature = false

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/.well-known/openid-configuration') {
    res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
      })
    )
    return
  }
  if (req.url === '/jwks') {
    res.end(JSON.stringify({ keys: [jwk] }))
    return
  }
  if (req.url === '/token' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const params = new URLSearchParams(body)
    const code = params.get('code') ?? ''
    const challenge = createHash('sha256')
      .update(params.get('code_verifier') ?? '')
      .digest('base64url')
    if (
      challenge !== codes.get(code) ||
      req.headers.authorization !==
        `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`
    ) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'invalid_grant' }))
      return
    }
    codes.delete(code)
    const now = Math.floor(Date.now() / 1000)
    const unsigned = [
      { alg: 'RS256', kid: jwk.kid },
      { iss: issuer, aud: 'test-client', iat: now, exp: now + 300, ...claims },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.')
    const signature = sign('RSA-SHA256', Buffer.from(unsigned), privateKey)
    if (badSignature) signature[0] ^= 255
    res.end(
      JSON.stringify({
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: `${unsigned}.${signature.toString('base64url')}`,
      })
    )
    return
  }
  res.statusCode = 404
  res.end('{}')
})

function makeUser(overrides: Partial<StoredUser> = {}): StoredUser {
  const id = overrides.id ?? 'admin'
  return {
    id,
    email: 'admin@example.test',
    name: 'Admin',
    role: 'ADMIN',
    sessionVersion: 1,
    image: null,
    password: null,
    emailVerified: null,
    oidcSubject: null,
    uploadToken: `${id}-upload-token`,
    urlId: `${id}-url-id`,
    ...overrides,
  }
}

function browser() {
  const cookies: Record<string, string> = {}
  async function request(
    action: AuthAction,
    method: 'GET' | 'POST' = 'GET',
    providerId?: string,
    body: Record<string, string> = {},
    query: Record<string, string> = {}
  ) {
    const result = await AuthHandler({
      options: {
        ...(await getAuthOptions()),
        secret: 'isolated-test-session-secret',
        logger: { error() {}, warn() {}, debug() {} },
      },
      req: {
        action,
        method,
        providerId,
        body,
        query,
        cookies: { ...cookies },
        headers: { host: 'localhost:3000' },
      },
    })
    for (const cookie of result.cookies ?? []) {
      if (cookie.options?.maxAge === 0) delete cookies[cookie.name]
      else cookies[cookie.name] = cookie.value
    }
    return result
  }

  async function login(tamperState = false) {
    const csrf = await request('csrf')
    const csrfToken = csrf.body?.csrfToken
    if (typeof csrfToken !== 'string') throw new Error('Missing CSRF token')
    const start = await request('signin', 'POST', 'oidc', {
      csrfToken,
      callbackUrl,
    })
    if (!start.redirect) throw new Error('Missing authorization redirect')
    const url = new URL(start.redirect)
    expect(url.origin).toBe(issuer)
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const challenge = url.searchParams.get('code_challenge')
    const state = url.searchParams.get('state')
    if (!challenge || !state) throw new Error('Missing PKCE challenge or state')

    // Simulate the IdP authorization screen granting access. Discovery, token
    // exchange, PKCE verification, and signed ID token validation use HTTP.
    const code = randomUUID()
    codes.set(code, challenge)
    return request(
      'callback',
      'GET',
      'oidc',
      {},
      { code, state: tamperState ? 'wrong-state' : state }
    )
  }
  return { login, request }
}

describe.sequential('OIDC protocol and application sign-in', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing test issuer address')
    }
    issuer = `http://127.0.0.1:${address.port}`
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    db.rows = [makeUser()]
    Object.assign(db.oidc, {
      issuer,
      autoProvision: true,
      requireEmailVerified: true,
      // Even a legacy setting reaching the callback must not revive linking.
      allowLinking: true,
    })
    claims = {
      sub: 'subject-1',
      email: 'person@example.test',
      email_verified: true,
      name: 'SSO User',
    }
    badSignature = false
    codes.clear()
  })

  it('provisions a user through a signed PKCE exchange and invalidates a revoked session', async () => {
    const client = browser()
    expect((await client.login()).redirect).toBe(callbackUrl)
    expect((await client.request('session')).body?.user).toMatchObject({
      id: 'user-1',
      email: 'person@example.test',
      role: 'USER',
    })
    expect(db.rows[1]).toMatchObject({
      oidcSubject: `${issuer}|subject-1`,
      emailVerified: expect.any(Date),
      password: null,
      uploadToken: expect.any(String),
      urlId: expect.any(String),
    })
    expect(db.create).toHaveBeenCalledOnce()

    db.rows[1].sessionVersion++
    expect((await client.request('session')).body).toEqual({})
  })

  it('resolves an existing subject after its email claim changes without rewriting the account', async () => {
    expect((await browser().login()).redirect).toBe(callbackUrl)
    const original = structuredClone(db.rows)
    claims.email = undefined
    claims.email_verified = false

    const returning = browser()
    expect((await returning.login()).redirect).toBe(callbackUrl)
    expect((await returning.request('session')).body?.user).toMatchObject({
      id: 'user-1',
      email: 'person@example.test',
    })
    expect(db.rows).toEqual(original)
    expect(db.create).toHaveBeenCalledOnce()
    expect(db.update).not.toHaveBeenCalled()
  })

  it.each(['state', 'signature', 'issuer', 'audience'] as const)(
    'rejects invalid %s before creating a user or session',
    async (invalid) => {
      if (invalid === 'signature') badSignature = true
      if (invalid === 'issuer') claims.iss = 'https://wrong.example.test'
      if (invalid === 'audience') claims.aud = 'wrong-client'
      const original = structuredClone(db.rows)
      const client = browser()

      expect((await client.login(invalid === 'state')).redirect).toContain(
        'error=OAuthCallback'
      )
      expect((await client.request('session')).body).toEqual({})
      expect(db.rows).toEqual(original)
      expect(db.create).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    }
  )

  it.each<{
    condition: string
    claims: Partial<IdTokenClaims>
    config: Partial<OidcSettings>
    error: string
  }>([
    {
      condition: 'unverified email',
      claims: { email_verified: false },
      config: {},
      error: 'OidcEmailUnverified',
    },
    {
      condition: 'missing email',
      claims: { email: undefined },
      config: {},
      error: 'OidcNoEmail',
    },
    {
      condition: 'disabled provisioning',
      claims: {},
      config: { autoProvision: false },
      error: 'OidcNotProvisioned',
    },
  ])('denies $condition with the expected login error', async (testCase) => {
    Object.assign(claims, testCase.claims)
    Object.assign(db.oidc, testCase.config)
    const client = browser()

    expect((await client.login()).redirect).toBe(
      `/auth/login?error=${testCase.error}`
    )
    expect((await client.request('session')).body).toEqual({})
    expect(db.rows).toHaveLength(1)
    expect(db.create).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  describe.each(['preclaimed local account', 'existing SSO account'] as const)(
    'email collision with %s',
    (accountKind) => {
      it.each([
        { requireEmailVerified: true, emailVerified: true },
        { requireEmailVerified: true, emailVerified: false },
        { requireEmailVerified: false, emailVerified: true },
        { requireEmailVerified: false, emailVerified: false },
      ])(
        'denies access without modifying credentials or identity (requireEmailVerified=$requireEmailVerified, emailVerified=$emailVerified)',
        async ({ requireEmailVerified, emailVerified }) => {
          db.rows.push(
            makeUser({
              id: 'existing',
              email: claims.email,
              name: 'Existing User',
              role: 'USER',
              sessionVersion: 7,
              password: 'existing-password-hash',
              oidcSubject:
                accountKind === 'existing SSO account'
                  ? `${issuer}|original-subject`
                  : null,
              uploadToken: 'existing-secret-upload-token',
              urlId: 'existing-url-id',
            })
          )
          db.oidc.requireEmailVerified = requireEmailVerified
          claims.email_verified = emailVerified
          const original = structuredClone(db.rows)
          const client = browser()
          const error =
            requireEmailVerified && !emailVerified
              ? 'OidcEmailUnverified'
              : 'OidcAccountExists'

          expect((await client.login()).redirect).toBe(
            `/auth/login?error=${error}`
          )
          expect((await client.request('session')).body).toEqual({})
          expect(db.rows).toEqual(original)
          expect(db.create).not.toHaveBeenCalled()
          expect(db.update).not.toHaveBeenCalled()
        }
      )
    }
  )

  it('provisions a distinct identity when another issuer uses the same subject with a different email', async () => {
    db.rows.push(
      makeUser({
        id: 'other-issuer',
        email: 'other@example.test',
        oidcSubject: 'https://other.example.test|subject-1',
      })
    )
    const otherAccount = structuredClone(db.rows[1])
    const client = browser()

    expect((await client.login()).redirect).toBe(callbackUrl)
    expect((await client.request('session')).body?.user).toMatchObject({
      id: 'user-2',
      email: 'person@example.test',
    })
    expect(db.rows[1]).toEqual(otherAccount)
    expect(db.rows[2].oidcSubject).toBe(`${issuer}|subject-1`)
  })

  it('rejects the same subject and email from a different issuer without replacing its identity', async () => {
    db.rows.push(
      makeUser({
        id: 'other-issuer',
        email: claims.email,
        oidcSubject: 'https://other.example.test|subject-1',
      })
    )
    const original = structuredClone(db.rows)
    const client = browser()

    expect((await client.login()).redirect).toBe(
      '/auth/login?error=OidcAccountExists'
    )
    expect((await client.request('session')).body).toEqual({})
    expect(db.rows).toEqual(original)
    expect(db.create).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })
})
