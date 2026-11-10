import { POST as challengeRoute } from '@/app/api/auth/e2ee/challenge/route'
import { PUT as keyringRoute } from '@/app/api/auth/e2ee/keyring/route'
import {
  POST as keySetupRoute,
  GET as keyStatusRoute,
} from '@/app/api/auth/e2ee/keys/route'
import { POST as recoveryChallengeRoute } from '@/app/api/auth/e2ee/recovery/challenge/route'
import { POST as recoveryRoute } from '@/app/api/auth/e2ee/recovery/route'
import { POST as resetRoute } from '@/app/api/auth/e2ee/reset/route'
import { POST as rotationRoute } from '@/app/api/auth/e2ee/rotation/route'
import { POST as sessionChallengeRoute } from '@/app/api/auth/e2ee/session-challenge/route'
import { POST as unlockRoute } from '@/app/api/auth/e2ee/unlock/route'
import { POST as legacyResetRoute } from '@/app/api/auth/email/reset/route'
import { POST as registerRoute } from '@/app/api/auth/register/route'
import { PUT as profileRoute } from '@/app/api/profile/route'
import { PUT as usersRoute } from '@/app/api/users/route'
import type { Prisma, User } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import type { Session } from 'next-auth'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { authOptions } from '@/lib/auth'
import { fakePassphraseSalt } from '@/lib/auth/e2ee/accounts'
import {
  SIGNED_REQUEST_CHALLENGE_HEADER,
  SIGNED_REQUEST_SIGNATURE_HEADER,
} from '@/lib/auth/e2ee/signed-request'
import { createTotp, encryptTotp } from '@/lib/auth/security/crypto'
import { setupTotp } from '@/lib/auth/security/service'
import {
  createBrowserSession,
  validateBrowserSession,
} from '@/lib/auth/sessions'
import { DEFAULT_CONFIG } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import {
  type AccountKeys,
  type Challenge,
  type PassphraseKeys,
  type PassphraseRoot,
  type RootEntropy,
  type SealNonce,
  base64urlDecode,
  base64urlEncode,
  deriveAccountKeys,
  ed25519Sign,
  encodeStoredRecord,
  passphraseKeysFromRoot,
  sealKeyring,
  signInSignature,
  signRequest,
  unlockSignature,
  wrapRoot,
} from '@/lib/e2ee'
import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/email/schema'
import { issueEmailToken } from '@/lib/email/tokens'
import { ensureBuiltInRoles } from '@/lib/permissions/server'

import { e2eeTestDatabaseUrl } from './e2ee-database-guard'
import { type ClientKeys, clientKeys } from './e2ee-test-keys'

const databaseUrl = process.env.FLARE_E2EE_DATABASE_URL

const state = vi.hoisted(() => ({
  session: null as unknown,
  config: null as unknown,
}))
vi.mock('next-auth', async (original) => ({
  ...(await original<object>()),
  getServerSession: async () => state.session,
}))
vi.mock('@/lib/database/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  const { withPrismaAudit } = await import('@/lib/audit/prisma')
  // Audited as in production.
  return {
    prisma: withPrismaAudit(
      new PrismaClient({
        datasourceUrl:
          process.env.FLARE_E2EE_DATABASE_URL ||
          'postgresql://unused@127.0.0.1/unused',
      })
    ),
  }
})
vi.mock('@/lib/email/config', async (original) => ({
  ...(await original<object>()),
  getEmailConfig: async () => state.config,
}))
vi.mock('@/lib/config', async (original) => ({
  ...(await original<object>()),
  getConfig: async () => ({
    settings: {
      general: {
        registrations: { enabled: true },
        oidc: { enabled: false, enforceSso: false },
      },
    },
  }),
}))

// Real queries; a full parallel run can take one past the 5 s default.
vi.setConfig({ testTimeout: 30_000 })

const ORIGIN = 'https://flare.example'
const PASSWORD = 'correct test password'

/** A different documentation-range address per request keeps per-address limits apart. */
function uniqueAddress() {
  return `2001:db8:${randomUUID().replaceAll('-', '').slice(0, 24).match(/.{4}/g)!.join(':')}`
}

const b64 = base64urlEncode

function keyringOf(current: AccountKeys, old: AccountKeys[]) {
  return b64(
    encodeStoredRecord(
      'sealed_keyring',
      sealKeyring({
        accountPrivateKey: current.accountPrivateKey,
        accountPublicKey: current.accountPublicKey,
        nonce: new Uint8Array(randomBytes(24)) as SealNonce,
        oldPrivateKeys: old.map((keys) => keys.accountPrivateKey),
      })
    )
  )
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST'
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': uniqueAddress(),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

type Authorize = (
  credentials: Record<string, string>,
  req: { headers: Record<string, string> }
) => Promise<Record<string, unknown> | null>

function provider(id: string): Authorize {
  const found = authOptions.providers.find((item) => {
    const value = item as unknown as { id: string; options?: { id?: string } }
    return (value.options?.id || value.id) === id
  }) as unknown as { options: { authorize: Authorize } }
  return found.options.authorize
}
const passphraseSignIn = (credentials: Record<string, string>) =>
  provider('passphrase')(credentials, {
    headers: { 'x-real-ip': uniqueAddress() },
  })
const passwordSignIn = (credentials: Record<string, string>) =>
  provider('credentials')(credentials, {
    headers: { 'x-real-ip': uniqueAddress() },
  })

describe.skipIf(!databaseUrl)(
  'account keys and passphrase sign-in (PostgreSQL)',
  () => {
    let passwordHash: string
    let savedSecret: string | undefined
    let config: EmailConfig

    beforeAll(async () => {
      // The suite deletes every user.
      e2eeTestDatabaseUrl(databaseUrl!)
      savedSecret = process.env.NEXTAUTH_SECRET
      process.env.NEXTAUTH_SECRET = 'disposable-e2ee-test-key-32-characters!'
      passwordHash = await hash(PASSWORD, 4)
      await prisma.$connect()
    })
    beforeEach(async () => {
      state.session = null
      config = {
        ...structuredClone(DEFAULT_EMAIL_CONFIG),
        enabled: true,
        smtp: {
          ...DEFAULT_EMAIL_CONFIG.smtp,
          host: 'smtp.example',
          authentication: false,
        },
        fromAddress: 'no-reply@example.com',
        publicUrl: ORIGIN,
        recovery: { ...DEFAULT_EMAIL_CONFIG.recovery, enabled: true },
      }
      state.config = config
      await prisma.auditEvent.deleteMany()
      await prisma.authChallenge.deleteMany()
      await prisma.authRateLimit.deleteMany()
      await prisma.emailRateLimit.deleteMany()
      await prisma.user.deleteMany()
      const value = JSON.parse(
        JSON.stringify({
          ...DEFAULT_CONFIG,
          settings: { ...DEFAULT_CONFIG.settings, email: config },
        })
      ) as Prisma.InputJsonValue
      await prisma.config.upsert({
        where: { key: 'flare_config' },
        create: { key: 'flare_config', value },
        update: { value },
      })
    })
    afterAll(async () => {
      await prisma.$disconnect()
      if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET
      else process.env.NEXTAUTH_SECRET = savedSecret
    })

    async function account(
      overrides: Partial<Prisma.UserCreateInput> = {}
    ): Promise<User> {
      const id = randomUUID()
      const email = `${id}@example.com`
      return prisma.user.create({
        data: {
          id,
          email,
          name: 'Test user',
          urlId: id,
          // The hash of an upload token from before encryption.
          uploadTokenHash: randomUUID(),
          emailVerified: new Date(),
          emailVerifiedFor: email,
          emailVerificationSource: 'email',
          ...overrides,
        },
      })
    }
    const legacyAccount = (overrides: Partial<Prisma.UserCreateInput> = {}) =>
      account({ password: passwordHash, ...overrides })
    async function keyedAccount(
      overrides: Partial<Prisma.UserCreateInput> = {}
    ) {
      const keys = clientKeys()
      const user = await account({ ...keys.columns, ...overrides })
      return { user, keys }
    }
    const reload = (user: User) =>
      prisma.user.findUniqueOrThrow({ where: { id: user.id } })

    /** Signs the account in: a tracked browser session, as the JWT callback makes it. */
    async function signIn(
      user: User,
      method = 'passphrase',
      authTime = Date.now()
    ) {
      const fresh = await reload(user)
      const record = await createBrowserSession(
        fresh.id,
        fresh.sessionVersion,
        method,
        { ipAddress: '192.0.2.10', userAgent: 'E2EE test browser' }
      )
      const access = await prisma.$transaction((tx) => ensureBuiltInRoles(tx))
      const session: Session = {
        expires: new Date(Date.now() + 3_600_000).toISOString(),
        user: {
          id: fresh.id,
          name: fresh.name || '',
          email: fresh.email || '',
          image: null,
          roles: [],
          permissions: access.administrator.permissions as never,
          sessionVersion: fresh.sessionVersion,
          sessionId: record.id,
          authMethod: method,
          authTime,
        },
      }
      state.session = session
      return session
    }

    async function signInChallenge(identifier: string) {
      const response = await challengeRoute(
        post('/api/auth/e2ee/challenge', { identifier })
      )
      expect(response.status).toBe(200)
      return (await response.json()) as {
        method: string
        passphraseSalt: string
        protocolVersion: number
        challenge: string
      }
    }
    async function sessionChallenge() {
      const response = await sessionChallengeRoute(
        post('/api/auth/e2ee/session-challenge', {})
      )
      expect(response.status).toBe(200)
      return (await response.json()) as {
        challenge: string
        identifier: string
        passphraseSalt: string
        accountPublicKey: string
      }
    }
    const challengeBytes = (challenge: string) =>
      base64urlDecode(challenge) as Challenge

    /** The credentials of a passphrase sign-in, signed as a browser signs them. */
    async function credentials(
      identifier: string,
      keys: PassphraseKeys,
      sign: typeof signInSignature = signInSignature
    ) {
      const { challenge } = await signInChallenge(identifier)
      return {
        identifier,
        challenge,
        signature: b64(
          sign({
            authPrivateKey: keys.authPrivateKey,
            challenge: challengeBytes(challenge),
            identifier,
          })
        ),
      }
    }

    /** A request signed with an account key (section 6.6), on a challenge of the session. */
    async function signedRequest(
      path: string,
      body: unknown,
      keys: AccountKeys,
      options: {
        method?: string
        challenge?: string
        signedPath?: string
        signedBody?: string
      } = {}
    ) {
      const method = options.method ?? 'POST'
      const challenge =
        options.challenge ?? (await sessionChallenge()).challenge
      const text = JSON.stringify(body)
      const { signature } = signRequest({
        accountPrivateKey: keys.accountPrivateKey,
        challenge: challengeBytes(challenge),
        method,
        path: options.signedPath ?? path,
        body: new TextEncoder().encode(options.signedBody ?? text),
      })
      return post(
        path,
        text,
        {
          [SIGNED_REQUEST_CHALLENGE_HEADER]: challenge,
          [SIGNED_REQUEST_SIGNATURE_HEADER]: b64(signature),
        },
        method
      )
    }

    async function passphraseProof(
      user: User,
      keys: PassphraseKeys,
      sign: typeof signInSignature = signInSignature
    ) {
      const { challenge } = await sessionChallenge()
      return {
        challenge,
        signature: b64(
          sign({
            authPrivateKey: keys.authPrivateKey,
            challenge: challengeBytes(challenge),
            identifier: user.email!,
          })
        ),
      }
    }

    async function rotationRequest(
      user: User,
      old: ClientKeys,
      next: ClientKeys,
      change: {
        proof?: { challenge: string; signature: string }
        requestKeys?: AccountKeys
        extra?: Record<string, unknown>
      } = {}
    ) {
      const body = {
        account: next.record,
        sealedKeyring: keyringOf(next.accountKeys, [old.accountKeys]),
        passphraseProof:
          change.proof ?? (await passphraseProof(user, old.passphraseKeys)),
        ...change.extra,
      }
      return signedRequest(
        '/api/auth/e2ee/rotation',
        body,
        change.requestKeys ?? old.accountKeys
      )
    }

    function resetLink(user: User, expiresAt = new Date(Date.now() + 60_000)) {
      return prisma.$transaction((tx) =>
        issueEmailToken(tx, {
          userId: user.id,
          email: user.email!,
          purpose: 'reset',
          expiresAt,
        })
      )
    }

    describe('salt and challenge request', () => {
      it('returns the salt, the protocol version and a 32-byte challenge for an account with keys', async () => {
        const { user, keys } = await keyedAccount()
        const answer = await signInChallenge(user.email!)
        expect(answer).toEqual({
          method: 'passphrase',
          passphraseSalt: b64(keys.passphraseSalt),
          protocolVersion: 1,
          challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        })
        const stored = await prisma.authChallenge.findUniqueOrThrow({
          where: { id: answer.challenge },
        })
        expect(stored.userId).toBe(user.id)
        expect(stored.purpose).toBe('e2ee_sign_in')
        const lifetime = stored.expiresAt.getTime() - Date.now()
        expect(lifetime).toBeGreaterThan(50_000)
        expect(lifetime).toBeLessThanOrEqual(60_000)
      })

      it('answers an unknown identifier in the same shape, with a salt that stays the same', async () => {
        const { user } = await keyedAccount()
        const known = await signInChallenge(user.email!)
        const first = await signInChallenge('nobody@example.com')
        const second = await signInChallenge('nobody@example.com')
        expect(Object.keys(first).sort()).toEqual(Object.keys(known).sort())
        expect(first.method).toBe('passphrase')
        expect(first.protocolVersion).toBe(known.protocolVersion)
        expect(first.passphraseSalt).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(second.passphraseSalt).toBe(first.passphraseSalt)
        expect(second.challenge).not.toBe(first.challenge)
        expect(first.passphraseSalt).toBe(
          b64(fakePassphraseSalt('nobody@example.com'))
        )
        // The identifier form of section 4.4, rule 7, also for the fake salt.
        expect(
          (await signInChallenge(' Ｎobody@EXAMPLE.com\n')).passphraseSalt
        ).toBe(first.passphraseSalt)
        expect(
          (await signInChallenge('somebody@example.com')).passphraseSalt
        ).not.toBe(first.passphraseSalt)
        // The same work as for a real account: one stored challenge, for nobody.
        const stored = await prisma.authChallenge.findUniqueOrThrow({
          where: { id: first.challenge },
        })
        expect(stored.userId).toBeNull()
      })

      it('gives a different fake salt under a different server secret', () => {
        const before = fakePassphraseSalt('nobody@example.com')
        const saved = process.env.NEXTAUTH_SECRET
        process.env.NEXTAUTH_SECRET = 'another-disposable-key-32-characters!!'
        try {
          expect(fakePassphraseSalt('nobody@example.com')).not.toEqual(before)
        } finally {
          process.env.NEXTAUTH_SECRET = saved
        }
        expect(fakePassphraseSalt('nobody@example.com')).toEqual(before)
      })

      it('tells the sign-in page to use the password form for an account without keys', async () => {
        const legacy = await legacyAccount()
        const response = await challengeRoute(
          post('/api/auth/e2ee/challenge', { identifier: legacy.email })
        )
        expect(await response.json()).toEqual({ method: 'password' })
        expect(await prisma.authChallenge.count()).toBe(0)
      })

      it('answers an account with no keys and no password as an unknown identifier', async () => {
        const ssoOnly = await account({ oidcSubject: 'issuer|subject' })
        const answer = await signInChallenge(ssoOnly.email!)
        expect(answer.method).toBe('passphrase')
        expect(answer.passphraseSalt).toBe(
          b64(fakePassphraseSalt(ssoOnly.email!))
        )
      })

      it('refuses a body with a field that it does not read', async () => {
        for (const body of [
          { identifier: 'a@example.com', passphrase: 'secret' },
          { identifier: 'a@example.com', password: 'secret' },
          {},
          { identifier: '' },
          { identifier: 'a'.repeat(321) },
        ]) {
          const response = await challengeRoute(
            post('/api/auth/e2ee/challenge', body)
          )
          expect(response.status).toBe(400)
        }
        expect(await prisma.authChallenge.count()).toBe(0)
      })

      it('refuses API credentials, other origins and other content types', async () => {
        const body = { identifier: 'a@example.com' }
        expect(
          (
            await challengeRoute(
              post('/api/auth/e2ee/challenge', body, {
                authorization: 'Bearer anything',
              })
            )
          ).status
        ).toBe(401)
        expect(
          (
            await challengeRoute(
              post('/api/auth/e2ee/challenge', body, {
                origin: 'https://other.example',
              })
            )
          ).status
        ).toBe(403)
        expect(
          (
            await challengeRoute(
              post('/api/auth/e2ee/challenge', body, {
                'Content-Type': 'text/plain',
              })
            )
          ).status
        ).toBe(415)
      })
    })

    describe('passphrase sign-in', () => {
      it('signs in with a signature of the sign-in key and returns no key material', async () => {
        const { user, keys } = await keyedAccount()
        const result = await passphraseSignIn(
          await credentials(user.email!, keys.passphraseKeys)
        )
        expect(result).toEqual({
          id: user.id,
          email: user.email,
          name: user.name,
          image: null,
          sessionVersion: 1,
        })
        expect(await prisma.authChallenge.count()).toBe(0)
      })

      it('reaches the same account for each spelling of the identifier', async () => {
        const keys = clientKeys()
        const user = await account({
          ...keys.columns,
          email: 'Mixed.Case@Example.com',
        })
        for (const identifier of [
          'mixed.case@example.com',
          'MIXED.CASE@EXAMPLE.COM',
          '  Mixed.Case@Example.com\t',
          ' mixed.case@example.com ',
          // NFKC: full-width letters.
          'Ｍｉｘｅｄ.case@example.com',
        ]) {
          expect(
            (await signInChallenge(identifier)).passphraseSalt,
            identifier
          ).toBe(b64(keys.passphraseSalt))
          expect(
            await passphraseSignIn(
              await credentials(identifier, keys.passphraseKeys)
            ),
            identifier
          ).toMatchObject({ id: user.id })
        }
      })

      it('prefers the exact address when older accounts differ only in letter case', async () => {
        const upper = clientKeys()
        const lower = clientKeys()
        const first = await account({
          ...upper.columns,
          email: 'Same@example.com',
        })
        const second = await account({
          ...lower.columns,
          email: 'same@example.com',
        })
        expect(
          await passphraseSignIn(
            await credentials('Same@example.com', upper.passphraseKeys)
          )
        ).toMatchObject({ id: first.id })
        expect(
          await passphraseSignIn(
            await credentials('same@example.com', lower.passphraseKeys)
          )
        ).toMatchObject({ id: second.id })
        // A third spelling names neither account.
        expect((await signInChallenge('SAME@example.com')).passphraseSalt).toBe(
          b64(fakePassphraseSalt('SAME@example.com'))
        )
      })

      it('refuses a replayed challenge', async () => {
        const { user, keys } = await keyedAccount()
        const proof = await credentials(user.email!, keys.passphraseKeys)
        expect(await passphraseSignIn(proof)).toMatchObject({ id: user.id })
        expect(await passphraseSignIn(proof)).toBeNull()
      })

      it('refuses an expired challenge, and deletes it', async () => {
        const { user, keys } = await keyedAccount()
        const proof = await credentials(user.email!, keys.passphraseKeys)
        await prisma.authChallenge.update({
          where: { id: proof.challenge },
          data: { expiresAt: new Date(Date.now() - 1) },
        })
        expect(await passphraseSignIn(proof)).toBeNull()
        expect(await prisma.authChallenge.count()).toBe(0)
      })

      it('deletes the challenge on its first presentation, also when the signature is wrong', async () => {
        const { user, keys } = await keyedAccount()
        const proof = await credentials(user.email!, keys.passphraseKeys)
        const wrong = b64(new Uint8Array(randomBytes(64)))
        expect(
          await passphraseSignIn({ ...proof, signature: wrong })
        ).toBeNull()
        expect(await prisma.authChallenge.count()).toBe(0)
        // The right signature is too late.
        expect(await passphraseSignIn(proof)).toBeNull()
      })

      it('refuses a signature with the unlock context', async () => {
        const { user, keys } = await keyedAccount()
        expect(
          await passphraseSignIn(
            await credentials(user.email!, keys.passphraseKeys, unlockSignature)
          )
        ).toBeNull()
      })

      it('refuses the wrong key, and the account key', async () => {
        const { user, keys } = await keyedAccount()
        expect(
          await passphraseSignIn(
            await credentials(user.email!, clientKeys().passphraseKeys)
          )
        ).toBeNull()
        // A person who has the account key from a browser has no passphrase.
        expect(
          await passphraseSignIn(
            await credentials(user.email!, {
              ...keys.passphraseKeys,
              authPrivateKey: keys.accountKeys.accountPrivateKey as never,
            })
          )
        ).toBeNull()
      })

      it('refuses a challenge of a different account, of a session, and of an unknown identifier', async () => {
        const { user, keys } = await keyedAccount()
        const other = await keyedAccount()
        const sign = (challenge: string) =>
          b64(
            signInSignature({
              authPrivateKey: keys.passphraseKeys.authPrivateKey,
              challenge: challengeBytes(challenge),
              identifier: user.email!,
            })
          )
        for (const challenge of [
          (await signInChallenge(other.user.email!)).challenge,
          (await signInChallenge('nobody@example.com')).challenge,
        ])
          expect(
            await passphraseSignIn({
              identifier: user.email!,
              challenge,
              signature: sign(challenge),
            })
          ).toBeNull()
        await signIn(user)
        const { challenge } = await sessionChallenge()
        expect(
          await passphraseSignIn({
            identifier: user.email!,
            challenge,
            signature: sign(challenge),
          })
        ).toBeNull()
        // An unknown identifier never signs in, whatever signs its challenge.
        const unknown = await credentials(
          'nobody@example.com',
          keys.passphraseKeys
        )
        expect(await passphraseSignIn(unknown)).toBeNull()
      })

      it('refuses fields that are missing, too long or not base64url', async () => {
        const { user, keys } = await keyedAccount()
        const proof = await credentials(user.email!, keys.passphraseKeys)
        for (const bad of [
          { ...proof, identifier: '' },
          { ...proof, identifier: 'a'.repeat(321) },
          { ...proof, challenge: proof.challenge.slice(1) },
          { ...proof, challenge: `${proof.challenge}=` },
          { ...proof, signature: proof.signature.slice(2) },
          { ...proof, signature: `${proof.signature.slice(0, -1)}+` },
          { ...proof, code: '1'.repeat(81) },
        ])
          expect(await passphraseSignIn(bad)).toBeNull()
        // None of them used the challenge up: they never reached the server check.
        expect(await passphraseSignIn(proof)).toMatchObject({ id: user.id })
      })

      it('applies the second factor of the password sign-in', async () => {
        const totp = createTotp()
        const { user, keys } = await keyedAccount({
          totpSecret: encryptTotp(totp.secret.base32),
        })
        const proof = () => credentials(user.email!, keys.passphraseKeys)
        await expect(passphraseSignIn(await proof())).rejects.toThrow(
          'TwoFactorRequired'
        )
        // The wrong passphrase never learns that a code is needed.
        expect(
          await passphraseSignIn(
            await credentials(user.email!, clientKeys().passphraseKeys)
          )
        ).toBeNull()
        expect(
          await passphraseSignIn({ ...(await proof()), code: '000000' })
        ).toBeNull()
        const code = totp.generate()
        expect(
          await passphraseSignIn({ ...(await proof()), code })
        ).toMatchObject({ id: user.id })
        // The same code does not work a second time.
        expect(await passphraseSignIn({ ...(await proof()), code })).toBeNull()
      })

      it('refuses an account that requires passkeys', async () => {
        const { user, keys } = await keyedAccount({ passkeyRequired: true })
        await expect(
          passphraseSignIn(await credentials(user.email!, keys.passphraseKeys))
        ).rejects.toThrow('PasskeyRequired')
      })

      it('records attempts in the login history without the proof', async () => {
        const { user, keys } = await keyedAccount()
        const proof = await credentials(
          user.email!,
          clientKeys().passphraseKeys
        )
        expect(await passphraseSignIn(proof)).toBeNull()
        await passphraseSignIn(
          await credentials('nobody@example.com', keys.passphraseKeys)
        )
        const attempts = await prisma.loginAttempt.findMany()
        expect(attempts).toHaveLength(1)
        expect(attempts[0]).toMatchObject({
          userId: user.id,
          authMethod: 'passphrase',
          outcome: 'failure',
        })
        const events = await prisma.auditEvent.findMany({
          where: { action: 'auth.login', targetId: user.id },
        })
        expect(JSON.stringify(events)).not.toContain(proof.signature)
      })

      it('shares the attempt limits of the password sign-in', async () => {
        const { user, keys } = await keyedAccount()
        const attempt = () =>
          passphraseSignIn({
            identifier: user.email!,
            challenge: b64(new Uint8Array(randomBytes(32))),
            signature: b64(new Uint8Array(randomBytes(64))),
          })
        for (let count = 0; count < 30; count++)
          expect(await attempt()).toBeNull()
        await expect(attempt()).rejects.toThrow('TooManyAttempts')
        // Also with the right proof, and for the password form of the same address.
        await expect(
          passphraseSignIn(await credentials(user.email!, keys.passphraseKeys))
        ).rejects.toThrow('TooManyAttempts')
        await expect(
          passwordSignIn({ email: user.email!, password: PASSWORD })
        ).rejects.toThrow('TooManyAttempts')
      })
    })

    describe('key setup', () => {
      it('lets an account from before encryption sign in with its password until key setup, and not afterwards', async () => {
        const legacy = await legacyAccount()
        const login = { email: legacy.email!, password: PASSWORD }
        expect(await passwordSignIn(login)).toMatchObject({ id: legacy.id })
        await signIn(legacy, 'credentials')
        expect(await (await keyStatusRoute(get())).json()).toEqual({
          hasKeys: false,
          identifier: legacy.email,
          protocolVersion: null,
          accountPublicKey: null,
          hasKeyring: false,
        })

        const keys = clientKeys()
        const response = await keySetupRoute(
          post('/api/auth/e2ee/keys', { account: keys.record })
        )
        expect(response.status).toBe(200)
        const saved = await reload(legacy)
        // The password hash is deleted with the same update.
        expect(saved.password).toBeNull()
        expect(saved).toMatchObject(keys.columns)
        expect(saved.sealedKeyring).toBeNull()
        // The session continues, for the unlock that follows.
        expect(saved.sessionVersion).toBe(legacy.sessionVersion)

        expect(await passwordSignIn(login)).toBeNull()
        expect(
          await passphraseSignIn(
            await credentials(legacy.email!, keys.passphraseKeys)
          )
        ).toMatchObject({ id: legacy.id })
        expect((await signInChallenge(legacy.email!)).method).toBe('passphrase')
        expect(await (await keyStatusRoute(get())).json()).toMatchObject({
          hasKeys: true,
          accountPublicKey: keys.record.accountPublicKey,
          protocolVersion: 1,
        })
      })

      it('gives keys to an account that signs in with SSO or a passkey', async () => {
        const ssoOnly = await account({ oidcSubject: 'issuer|subject' })
        await signIn(ssoOnly, 'oidc')
        const keys = clientKeys()
        expect(
          (
            await keySetupRoute(
              post('/api/auth/e2ee/keys', { account: keys.record })
            )
          ).status
        ).toBe(200)
        expect(await reload(ssoOnly)).toMatchObject(keys.columns)
      })

      it('needs a session from a recent sign-in', async () => {
        const legacy = await legacyAccount()
        const body = { account: clientKeys().record }
        expect(
          (await keySetupRoute(post('/api/auth/e2ee/keys', body))).status
        ).toBe(401)
        await signIn(legacy, 'credentials', Date.now() - 6 * 60_000)
        const stale = await keySetupRoute(post('/api/auth/e2ee/keys', body))
        expect(stale.status).toBe(403)
        expect(await stale.json()).toMatchObject({
          code: 'recent_sign_in_required',
        })
        await signIn(legacy, 'credentials', Date.now() + 60_000)
        expect(
          (await keySetupRoute(post('/api/auth/e2ee/keys', body))).status
        ).toBe(403)
        expect((await reload(legacy)).authPublicKey).toBeNull()
        expect((await reload(legacy)).password).toBe(passwordHash)
      })

      it('refuses a second key setup: only a rotation replaces keys', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        const response = await keySetupRoute(
          post('/api/auth/e2ee/keys', { account: clientKeys().record })
        )
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ code: 'keys_exist' })
        expect(await reload(user)).toMatchObject(keys.columns)
      })

      it('refuses a body with a secret or any other field that it does not read', async () => {
        const legacy = await legacyAccount()
        await signIn(legacy, 'credentials')
        const { record } = clientKeys()
        for (const body of [
          { account: record, passphrase: 'never sent' },
          { account: record, password: PASSWORD },
          { account: { ...record, passphrase: 'never sent' } },
          { account: { ...record, wrapKey: b64(randomBytes(32)) } },
          { account: { ...record, rootEntropy: b64(randomBytes(32)) } },
          { account: { ...record, accountPrivateKey: b64(randomBytes(32)) } },
          { account: { ...record, authPrivateKey: b64(randomBytes(32)) } },
          { account: { ...record, sealedKeyring: null } },
          { account: record, sealedKeyring: null },
        ]) {
          const response = await keySetupRoute(
            post('/api/auth/e2ee/keys', body)
          )
          expect(response.status, JSON.stringify(Object.keys(body))).toBe(400)
          expect((await response.json()).error).toMatch(/Unrecognized key/)
        }
        expect((await reload(legacy)).authPublicKey).toBeNull()
      })

      it('checks each length, each public key and the protocol version', async () => {
        const legacy = await legacyAccount()
        await signIn(legacy, 'credentials')
        const { record } = clientKeys()
        // y = 2^255 - 1 is not less than the field prime.
        const notAPoint = b64(new Uint8Array(32).fill(0xff))
        // y = 1 decodes, and has no X25519 form.
        const identity = b64(Uint8Array.of(1, ...new Uint8Array(31)))
        const stored = base64urlDecode(record.wrappedRoot)
        for (const [field, value] of [
          ['accountPublicKey', notAPoint],
          ['accountPublicKey', identity],
          ['accountPublicKey', b64(randomBytes(31))],
          ['accountPublicKey', `${record.accountPublicKey}A`],
          ['accountPublicKey', `${record.accountPublicKey.slice(0, -1)}=`],
          ['authPublicKey', notAPoint],
          ['authPublicKey', identity],
          ['authPublicKey', b64(randomBytes(33))],
          ['passphraseSalt', b64(randomBytes(16))],
          ['passphraseSalt', b64(randomBytes(64))],
          ['passphraseSalt', 42],
          ['protocolVersion', 2],
          ['protocolVersion', '1'],
          // Without the record_version byte, with a wrong one, and too long.
          ['wrappedRoot', b64(stored.subarray(1))],
          ['wrappedRoot', b64(Uint8Array.of(2, ...stored.subarray(1)))],
          ['wrappedRoot', b64(Uint8Array.of(...stored, 0))],
          ['wrappedRoot', ''],
        ] as const) {
          const response = await keySetupRoute(
            post('/api/auth/e2ee/keys', {
              account: { ...record, [field]: value },
            })
          )
          expect(response.status, `${field}=${value}`).toBe(400)
        }
        // Each refusal counted toward the account's management limit.
        await prisma.authRateLimit.deleteMany()
        for (const field of Object.keys(record)) {
          const partial: Record<string, unknown> = { ...record }
          delete partial[field]
          expect(
            (
              await keySetupRoute(
                post('/api/auth/e2ee/keys', { account: partial })
              )
            ).status,
            field
          ).toBe(400)
        }
        expect((await reload(legacy)).authPublicKey).toBeNull()
      })

      it('creates a registered account with its account record and no password hash', async () => {
        const keys = clientKeys()
        const body = {
          email: 'new@example.com',
          name: 'New user',
          account: keys.record,
        }
        const refused = await registerRoute(
          post('/api/auth/register', { ...body, password: PASSWORD })
        )
        expect(refused.status).toBe(400)
        expect(
          (
            await registerRoute(
              post('/api/auth/register', {
                email: body.email,
                name: body.name,
                password: PASSWORD,
              })
            )
          ).status
        ).toBe(400)
        expect(await prisma.user.count()).toBe(0)

        const response = await registerRoute(post('/api/auth/register', body))
        expect(response.status).toBe(200)
        const created = await prisma.user.findUniqueOrThrow({
          where: { email: 'new@example.com' },
        })
        expect(created.password).toBeNull()
        expect(created).toMatchObject(keys.columns)
        expect(
          await passphraseSignIn(
            await credentials('new@example.com', keys.passphraseKeys)
          )
        ).toMatchObject({ id: created.id })
      })

      it('never stores keys beside a password hash', async () => {
        const { user } = await keyedAccount()
        await expect(
          prisma.user.update({
            where: { id: user.id },
            data: { password: passwordHash },
          })
        ).rejects.toThrow()
        const legacy = await legacyAccount()
        await expect(
          prisma.user.update({
            where: { id: legacy.id },
            data: { authPublicKey: new Uint8Array(32) },
          })
        ).rejects.toThrow()
      })
    })

    function get(path = '/api/auth/e2ee/keys') {
      return new Request(`${ORIGIN}${path}`, {
        headers: { 'x-real-ip': uniqueAddress() },
      })
    }

    describe('unlock', () => {
      async function unlockRequest(
        user: User,
        keys: PassphraseKeys,
        sign: typeof unlockSignature = unlockSignature
      ) {
        const { challenge } = await sessionChallenge()
        return {
          challenge,
          signature: b64(
            sign({
              authPrivateKey: keys.authPrivateKey,
              challenge: challengeBytes(challenge),
              identifier: user.email!,
            })
          ),
        }
      }
      const unlock = (body: unknown) =>
        unlockRoute(post('/api/auth/e2ee/unlock', body))

      it('releases wrapped_root and sealed_keyring for the unlock signature', async () => {
        const old = clientKeys()
        const keys = clientKeys()
        const sealedKeyring = keyringOf(keys.accountKeys, [old.accountKeys])
        const user = await account({
          ...keys.columns,
          sealedKeyring: Uint8Array.from(base64urlDecode(sealedKeyring)),
        })
        await signIn(user)
        const challenge = await sessionChallenge()
        expect(challenge).toMatchObject({
          identifier: user.email,
          passphraseSalt: b64(keys.passphraseSalt),
          accountPublicKey: keys.record.accountPublicKey,
          protocolVersion: 1,
        })
        const response = await unlock(
          await unlockRequest(user, keys.passphraseKeys)
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({
          accountPublicKey: keys.record.accountPublicKey,
          protocolVersion: 1,
          wrappedRoot: keys.record.wrappedRoot,
          sealedKeyring,
        })
      })

      it('works after a passkey or SSO sign-in, and returns null for no keyring', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user, 'passkey')
        const response = await unlock(
          await unlockRequest(user, keys.passphraseKeys)
        )
        expect(await response.json()).toMatchObject({
          wrappedRoot: keys.record.wrappedRoot,
          sealedKeyring: null,
        })
      })

      it('needs a session', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        const body = await unlockRequest(user, keys.passphraseKeys)
        state.session = null
        expect((await unlock(body)).status).toBe(401)
        expect(
          (
            await sessionChallengeRoute(
              post('/api/auth/e2ee/session-challenge', {})
            )
          ).status
        ).toBe(401)
        expect((await keyStatusRoute(get())).status).toBe(401)
      })

      it('never releases key material to a session alone', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        for (const response of [
          await keyStatusRoute(get()),
          await sessionChallengeRoute(
            post('/api/auth/e2ee/session-challenge', {})
          ),
        ]) {
          const text = await response.text()
          expect(text).not.toContain(keys.record.wrappedRoot)
          expect(text).not.toContain('wrappedRoot')
        }
        const { challenge } = await sessionChallenge()
        for (const body of [
          {},
          { challenge },
          { challenge, signature: b64(randomBytes(64)) },
        ]) {
          const response = await unlock(body)
          expect(response.status).toBe(400)
          expect(await response.text()).not.toContain('wrappedRoot')
        }
      })

      it('refuses a replayed challenge and an expired challenge', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        const body = await unlockRequest(user, keys.passphraseKeys)
        expect((await unlock(body)).status).toBe(200)
        const replay = await unlock(body)
        expect(replay.status).toBe(400)
        expect(await replay.json()).toMatchObject({ code: 'invalid_proof' })

        const late = await unlockRequest(user, keys.passphraseKeys)
        await prisma.authChallenge.update({
          where: { id: late.challenge },
          data: { expiresAt: new Date(Date.now() - 1) },
        })
        expect((await unlock(late)).status).toBe(400)
        expect(await prisma.authChallenge.count()).toBe(0)
      })

      it('refuses a signature with the sign-in context, the wrong key and the account key', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        expect(
          (
            await unlock(
              await unlockRequest(user, keys.passphraseKeys, signInSignature)
            )
          ).status
        ).toBe(400)
        expect(
          (await unlock(await unlockRequest(user, clientKeys().passphraseKeys)))
            .status
        ).toBe(400)
        expect(
          (
            await unlock(
              await unlockRequest(user, {
                ...keys.passphraseKeys,
                authPrivateKey: keys.accountKeys.accountPrivateKey as never,
              })
            )
          ).status
        ).toBe(400)
      })

      it('refuses a challenge of the sign-in form, of a different account and of an older session version', async () => {
        const { user, keys } = await keyedAccount()
        const other = await keyedAccount()
        const sign = (challenge: string) => ({
          challenge,
          signature: b64(
            unlockSignature({
              authPrivateKey: keys.passphraseKeys.authPrivateKey,
              challenge: challengeBytes(challenge),
              identifier: user.email!,
            })
          ),
        })
        const fromSignIn = (await signInChallenge(user.email!)).challenge
        await signIn(other.user)
        const fromOther = (await sessionChallenge()).challenge
        await signIn(user)
        expect((await unlock(sign(fromSignIn))).status).toBe(400)
        expect((await unlock(sign(fromOther))).status).toBe(400)

        const stale = (await sessionChallenge()).challenge
        await prisma.authChallenge.update({
          where: { id: stale },
          data: { sessionVersion: 0 },
        })
        expect((await unlock(sign(stale))).status).toBe(400)
      })

      it('refuses a body with a field that it does not read', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        const body = await unlockRequest(user, keys.passphraseKeys)
        for (const extra of [
          { passphrase: 'never sent' },
          { wrapKey: b64(randomBytes(32)) },
          { identifier: user.email },
        ]) {
          const response = await unlock({ ...body, ...extra })
          expect(response.status).toBe(400)
          expect((await response.json()).error).toMatch(/Unrecognized key/)
        }
        // A refused body did not use the challenge up.
        expect((await unlock(body)).status).toBe(200)
      })

      it('tells an account without keys to set them up first', async () => {
        const legacy = await legacyAccount()
        await signIn(legacy, 'credentials')
        for (const response of [
          await sessionChallengeRoute(
            post('/api/auth/e2ee/session-challenge', {})
          ),
          await unlock({
            challenge: b64(randomBytes(32)),
            signature: b64(randomBytes(64)),
          }),
        ]) {
          expect(response.status).toBe(409)
          expect(await response.json()).toMatchObject({ code: 'keys_required' })
        }
      })

      it('limits attempts for each account', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        const bad = {
          challenge: b64(randomBytes(32)),
          signature: b64(randomBytes(64)),
        }
        for (let count = 0; count < 30; count++)
          expect((await unlock(bad)).status).toBe(400)
        const proof = await unlockRequest(user, keys.passphraseKeys)
        const limited = await unlock(proof)
        expect(limited.status).toBe(429)
        expect(limited.headers.get('retry-after')).toBe('900')
      })
    })

    describe('rotation and passphrase change', () => {
      it('replaces the account record with both proofs, then cancels sessions and tokens', async () => {
        const { user, keys: old } = await keyedAccount()
        const next = clientKeys()
        const session = await signIn(user)
        await prisma.apiToken.createMany({
          data: [
            { userId: user.id, name: 'one', hash: randomUUID(), scopes: [] },
            { userId: user.id, name: 'two', hash: randomUUID(), scopes: [] },
          ],
        })
        const bystander = await keyedAccount()
        await prisma.apiToken.create({
          data: {
            userId: bystander.user.id,
            name: 'kept',
            hash: randomUUID(),
            scopes: [],
          },
        })
        const pendingSignIn = await credentials(user.email!, old.passphraseKeys)

        const request = await rotationRequest(user, old, next)
        const body = JSON.parse(await request.clone().text())
        const response = await rotationRoute(request)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, signInAgain: true })

        const saved = await reload(user)
        expect(saved).toMatchObject(next.columns)
        expect(b64(saved.sealedKeyring!)).toBe(body.sealedKeyring)
        expect(saved.password).toBeNull()
        // Sessions: the version moves on, and the old session is refused.
        expect(saved.sessionVersion).toBe(user.sessionVersion + 1)
        await expect(
          validateBrowserSession(
            user.id,
            session.user.sessionId,
            saved.sessionVersion
          )
        ).rejects.toThrow('Session invalidated')
        expect(
          (
            await sessionChallengeRoute(
              post('/api/auth/e2ee/session-challenge', {})
            )
          ).status
        ).toBe(401)
        // Tokens: named tokens deleted, the legacy upload token revoked.
        expect(
          await prisma.apiToken.count({ where: { userId: user.id } })
        ).toBe(0)
        expect(await prisma.apiToken.count()).toBe(1)
        expect(user.uploadTokenHash).not.toBeNull()
        expect(saved.uploadTokenHash).toBeNull()
        expect(
          await prisma.user.findUnique({
            where: { uploadTokenHash: user.uploadTokenHash! },
          })
        ).toBeNull()
        // Pending challenges of the account are gone with the old keys.
        expect(
          await prisma.authChallenge.count({ where: { userId: user.id } })
        ).toBe(0)
        expect(await passphraseSignIn(pendingSignIn)).toBeNull()

        // The old passphrase is out, the new one is in.
        expect(
          await passphraseSignIn(
            await credentials(user.email!, old.passphraseKeys)
          )
        ).toBeNull()
        expect(
          await passphraseSignIn(
            await credentials(user.email!, next.passphraseKeys)
          )
        ).toMatchObject({ id: user.id, sessionVersion: saved.sessionVersion })
        // The rotation is in the audit log, without key material.
        const events = await prisma.auditEvent.findMany({
          where: { action: 'auth.keys.rotate' },
        })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          category: 'authentication',
          outcome: 'success',
        })
        const log = JSON.stringify(await prisma.auditEvent.findMany())
        for (const secret of [
          next.record.wrappedRoot,
          next.record.authPublicKey,
          body.sealedKeyring,
          body.passphraseProof.signature,
        ])
          expect(log).not.toContain(secret)
      })

      async function expectRefused(
        user: User,
        old: ClientKeys,
        request: Request
      ) {
        const response = await rotationRoute(request)
        expect(response.status).toBe(400)
        const saved = await reload(user)
        expect(saved).toMatchObject(old.columns)
        expect(saved.sessionVersion).toBe(user.sessionVersion)
        expect(saved.uploadTokenHash).toBe(user.uploadTokenHash)
        return response
      }

      it('refuses the account key signature without the passphrase proof', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        // A person who took the account key from the browser: no sign-in key.
        const stolen = await passphraseProof(user, {
          ...old.passphraseKeys,
          authPrivateKey: old.accountKeys.accountPrivateKey as never,
        })
        const response = await expectRefused(
          user,
          old,
          await rotationRequest(user, old, next, { proof: stolen })
        )
        expect(await response.json()).toMatchObject({ code: 'invalid_proof' })
        for (const proof of [
          await passphraseProof(user, clientKeys().passphraseKeys),
          // The unlock context is not a rotation proof.
          await passphraseProof(user, old.passphraseKeys, unlockSignature),
          {
            challenge: b64(randomBytes(32)),
            signature: b64(randomBytes(64)),
          },
        ])
          await expectRefused(
            user,
            old,
            await rotationRequest(user, old, next, { proof })
          )
        // No proof at all is not a valid body.
        const body = {
          account: next.record,
          sealedKeyring: null,
        }
        await expectRefused(
          user,
          old,
          await signedRequest('/api/auth/e2ee/rotation', body, old.accountKeys)
        )
      })

      it('refuses the passphrase proof without the account key signature', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        // Signed with the new key, with a stranger's key, and with the sign-in key.
        for (const requestKeys of [
          next.accountKeys,
          clientKeys().accountKeys,
          {
            ...old.accountKeys,
            accountPrivateKey: old.passphraseKeys.authPrivateKey as never,
          },
        ])
          await expectRefused(
            user,
            old,
            await rotationRequest(user, old, next, { requestKeys })
          )
        // No signature headers.
        const body = {
          account: next.record,
          sealedKeyring: null,
          passphraseProof: await passphraseProof(user, old.passphraseKeys),
        }
        await expectRefused(user, old, post('/api/auth/e2ee/rotation', body))
        // The proof of the refused request is not left for a second try.
        expect(
          await prisma.authChallenge.count({ where: { userId: user.id } })
        ).toBeLessThanOrEqual(1)
      })

      it('uses both challenges up when either proof fails', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        const proof = await passphraseProof(user, old.passphraseKeys)
        await expectRefused(
          user,
          old,
          await rotationRequest(user, old, next, {
            proof,
            requestKeys: next.accountKeys,
          })
        )
        expect(await prisma.authChallenge.count()).toBe(0)
        // The valid passphrase proof cannot be presented again.
        await expectRefused(
          user,
          old,
          await rotationRequest(user, old, next, { proof })
        )
      })

      it('refuses one challenge for both proofs, a replay and a changed body', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        const { challenge } = await sessionChallenge()
        const shared = {
          challenge,
          signature: b64(
            signInSignature({
              authPrivateKey: old.passphraseKeys.authPrivateKey,
              challenge: challengeBytes(challenge),
              identifier: user.email!,
            })
          ),
        }
        const body = {
          account: next.record,
          sealedKeyring: null,
          passphraseProof: shared,
        }
        await expectRefused(
          user,
          old,
          await signedRequest(
            '/api/auth/e2ee/rotation',
            body,
            old.accountKeys,
            {
              challenge,
            }
          )
        )

        // The signature covers the body: a different account record fails.
        const attacker = clientKeys()
        const honest = {
          account: next.record,
          sealedKeyring: null,
          passphraseProof: await passphraseProof(user, old.passphraseKeys),
        }
        await expectRefused(
          user,
          old,
          await signedRequest(
            '/api/auth/e2ee/rotation',
            { ...honest, account: attacker.record },
            old.accountKeys,
            { signedBody: JSON.stringify(honest) }
          )
        )

        // A complete valid request works one time only.
        const request = await rotationRequest(user, old, next)
        const replay = request.clone()
        expect((await rotationRoute(request)).status).toBe(200)
        await signIn(user)
        expect((await rotationRoute(replay)).status).toBe(400)
        expect(await reload(user)).toMatchObject(next.columns)
      })

      it('refuses a signature for a different method or path', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        const body = async () => ({
          account: next.record,
          sealedKeyring: null,
          passphraseProof: await passphraseProof(user, old.passphraseKeys),
        })
        for (const options of [
          { signedPath: '/api/auth/e2ee/keyring' },
          { signedPath: '/api/auth/e2ee/rotation?x=1' },
          { signedPath: '/api/auth/e2ee/rotation/' },
        ])
          await expectRefused(
            user,
            old,
            await signedRequest(
              '/api/auth/e2ee/rotation',
              await body(),
              old.accountKeys,
              options
            )
          )
        // Signed as PUT, sent as POST.
        const { challenge } = await sessionChallenge()
        const text = JSON.stringify(await body())
        const { signature } = signRequest({
          accountPrivateKey: old.accountKeys.accountPrivateKey,
          challenge: challengeBytes(challenge),
          method: 'PUT',
          path: '/api/auth/e2ee/rotation',
          body: new TextEncoder().encode(text),
        })
        await expectRefused(
          user,
          old,
          post('/api/auth/e2ee/rotation', text, {
            [SIGNED_REQUEST_CHALLENGE_HEADER]: challenge,
            [SIGNED_REQUEST_SIGNATURE_HEADER]: b64(signature),
          })
        )
      })

      it('signs the path with its query, as the request line has it', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        const path = '/api/auth/e2ee/rotation?from=settings&x=%2F'
        const response = await rotationRoute(
          await signedRequest(
            path,
            {
              account: next.record,
              sealedKeyring: null,
              passphraseProof: await passphraseProof(user, old.passphraseKeys),
            },
            old.accountKeys
          )
        )
        expect(response.status).toBe(200)
        expect((await reload(user)).sealedKeyring).toBeNull()
      })

      it('needs new keys and a new salt', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        for (const reused of [
          { accountPublicKey: old.record.accountPublicKey },
          { authPublicKey: old.record.authPublicKey },
          { passphraseSalt: old.record.passphraseSalt },
        ])
          await expectRefused(
            user,
            old,
            await rotationRequest(user, old, {
              ...next,
              record: { ...next.record, ...reused },
            })
          )
      })

      it('refuses a body with a secret or with records that the server cannot store yet', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const next = clientKeys()
        for (const extra of [
          { passphrase: 'never sent' },
          { newPassphrase: 'never sent' },
          { rootEntropy: b64(randomBytes(32)) },
          { oldPrivateKeys: [b64(randomBytes(32))] },
          { sealedTagMetadata: [] },
          { sealedFolderPrivateKeys: [] },
        ]) {
          const response = await expectRefused(
            user,
            old,
            await rotationRequest(user, old, next, { extra })
          )
          expect((await response.json()).error).toMatch(/Unrecognized key/)
        }
        const nested = await rotationRoute(
          await signedRequest(
            '/api/auth/e2ee/rotation',
            {
              account: next.record,
              sealedKeyring: null,
              passphraseProof: {
                ...(await passphraseProof(user, old.passphraseKeys)),
                passphrase: 'never sent',
              },
            },
            old.accountKeys
          )
        )
        expect(nested.status).toBe(400)
        // A sealed empty keyring is not a valid record (section 4.4, rule 11).
        const emptyKeyring = b64(Uint8Array.of(1, ...randomBytes(56)))
        const response = await rotationRoute(
          await signedRequest(
            '/api/auth/e2ee/rotation',
            {
              account: next.record,
              sealedKeyring: emptyKeyring,
              passphraseProof: await passphraseProof(user, old.passphraseKeys),
            },
            old.accountKeys
          )
        )
        expect(response.status).toBe(400)
        expect(await reload(user)).toMatchObject(old.columns)
      })

      it('needs a session and an account with keys', async () => {
        const { user, keys: old } = await keyedAccount()
        await signIn(user)
        const request = await rotationRequest(user, old, clientKeys())
        state.session = null
        expect((await rotationRoute(request)).status).toBe(401)
        expect(await reload(user)).toMatchObject(old.columns)
      })
    })

    describe('keyring update', () => {
      it('replaces and removes the keyring for a request signed with the current account key', async () => {
        const { user, keys } = await keyedAccount()
        const old = clientKeys()
        await signIn(user)
        const sealedKeyring = keyringOf(keys.accountKeys, [old.accountKeys])
        const put = (body: unknown, signer = keys.accountKeys) =>
          signedRequest('/api/auth/e2ee/keyring', body, signer, {
            method: 'PUT',
          })
        expect((await keyringRoute(await put({ sealedKeyring }))).status).toBe(
          200
        )
        expect(b64((await reload(user)).sealedKeyring!)).toBe(sealedKeyring)
        // Nothing else changes: the session and the tokens stay.
        expect((await reload(user)).sessionVersion).toBe(user.sessionVersion)

        // Not signed, signed with a different key, signed for POST.
        expect(
          (
            await keyringRoute(
              post('/api/auth/e2ee/keyring', { sealedKeyring: null }, {}, 'PUT')
            )
          ).status
        ).toBe(400)
        expect(
          (
            await keyringRoute(
              await put({ sealedKeyring: null }, old.accountKeys)
            )
          ).status
        ).toBe(400)
        expect(
          (
            await keyringRoute(
              await signedRequest(
                '/api/auth/e2ee/keyring',
                { sealedKeyring: null },
                keys.accountKeys,
                { method: 'PUT', signedPath: '/api/auth/e2ee/rotation' }
              )
            )
          ).status
        ).toBe(400)
        expect(
          (
            await keyringRoute(
              await put({ sealedKeyring: null, passphrase: 'never sent' })
            )
          ).status
        ).toBe(400)
        expect(b64((await reload(user)).sealedKeyring!)).toBe(sealedKeyring)

        expect(
          (await keyringRoute(await put({ sealedKeyring: null }))).status
        ).toBe(200)
        expect((await reload(user)).sealedKeyring).toBeNull()
      })
    })

    describe('recovery and reset by email', () => {
      /** A recovery request: signed with the account key that the mnemonic gives. */
      async function recoveryRequest(
        token: string,
        signer: AccountKeys,
        next: ClientKeys,
        old: AccountKeys[] = [signer]
      ) {
        const response = await recoveryChallengeRoute(
          post('/api/auth/e2ee/recovery/challenge', { token })
        )
        expect(response.status).toBe(200)
        const { challenge } = (await response.json()) as { challenge: string }
        return signedRequest(
          '/api/auth/e2ee/recovery',
          {
            token,
            account: next.record,
            sealedKeyring: keyringOf(next.accountKeys, old),
          },
          signer,
          { challenge }
        )
      }

      it('describes a reset link without using it up, and never returns wrapped_root', async () => {
        const older = clientKeys()
        const keys = clientKeys()
        const sealedKeyring = keyringOf(keys.accountKeys, [older.accountKeys])
        const user = await account({
          ...keys.columns,
          sealedKeyring: Uint8Array.from(base64urlDecode(sealedKeyring)),
        })
        const { token } = await resetLink(user)
        for (let count = 0; count < 2; count++) {
          const response = await recoveryChallengeRoute(
            post('/api/auth/e2ee/recovery/challenge', { token })
          )
          expect(response.status).toBe(200)
          const text = await response.text()
          expect(text).not.toContain(keys.record.wrappedRoot)
          expect(JSON.parse(text)).toEqual({
            hasKeys: true,
            accountPublicKey: keys.record.accountPublicKey,
            protocolVersion: 1,
            sealedKeyring,
            // The sealed folder keys and tag records, which a recovery seals
            // again for the new account key. This account has none.
            folders: [],
            tags: [],
            challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
          })
        }
        const legacy = await legacyAccount()
        const legacyLink = await resetLink(legacy)
        expect(
          await (
            await recoveryChallengeRoute(
              post('/api/auth/e2ee/recovery/challenge', {
                token: legacyLink.token,
              })
            )
          ).json()
        ).toEqual({ hasKeys: false })
        for (const bad of [
          { token: 'not-a-link' },
          { token: (await resetLink(user, new Date(Date.now() - 1))).token },
          { token, passphrase: 'never sent' },
        ])
          expect(
            (
              await recoveryChallengeRoute(
                post('/api/auth/e2ee/recovery/challenge', bad)
              )
            ).status
          ).toBe(400)
      })

      it('recovers with the email link and the account key of the mnemonic', async () => {
        const { user, keys: old } = await keyedAccount()
        const next = clientKeys()
        await prisma.apiToken.create({
          data: {
            userId: user.id,
            name: 'one',
            hash: randomUUID(),
            scopes: [],
          },
        })
        const { token } = await resetLink(user)
        const request = await recoveryRequest(token, old.accountKeys, next)
        const sent = JSON.parse(await request.clone().text())
        const response = await recoveryRoute(request)
        expect(response.status).toBe(200)

        const saved = await reload(user)
        expect(saved).toMatchObject(next.columns)
        // The keyring continues: the old key still opens the old stanzas.
        expect(b64(saved.sealedKeyring!)).toBe(sent.sealedKeyring)
        expect(saved.sessionVersion).toBe(user.sessionVersion + 1)
        expect(saved.uploadTokenHash).toBeNull()
        expect(await prisma.apiToken.count()).toBe(0)
        expect(
          await prisma.emailToken.count({
            where: { userId: user.id, consumedAt: null },
          })
        ).toBe(0)
        expect(
          await passphraseSignIn(
            await credentials(user.email!, old.passphraseKeys)
          )
        ).toBeNull()
        expect(
          await passphraseSignIn(
            await credentials(user.email!, next.passphraseKeys)
          )
        ).toMatchObject({ id: user.id })
        // The link worked one time.
        expect(
          (
            await recoveryChallengeRoute(
              post('/api/auth/e2ee/recovery/challenge', { token })
            )
          ).status
        ).toBe(400)
      })

      it('refuses a recovery without the account key, and keeps the link for the owner', async () => {
        const { user, keys: old } = await keyedAccount()
        const next = clientKeys()
        const { token } = await resetLink(user)
        // The email link alone: signed with some other key, and with the sign-in key.
        for (const signer of [
          next.accountKeys,
          {
            ...old.accountKeys,
            accountPrivateKey: old.passphraseKeys.authPrivateKey as never,
          },
        ]) {
          const response = await recoveryRoute(
            await recoveryRequest(token, signer, next, [old.accountKeys])
          )
          expect(response.status).toBe(400)
        }
        // Not signed at all.
        expect(
          (
            await recoveryRoute(
              post('/api/auth/e2ee/recovery', {
                token,
                account: next.record,
                sealedKeyring: null,
              })
            )
          ).status
        ).toBe(400)
        // A challenge of a session is not a recovery challenge.
        await signIn(user)
        const { challenge } = await sessionChallenge()
        state.session = null
        expect(
          (
            await recoveryRoute(
              await signedRequest(
                '/api/auth/e2ee/recovery',
                { token, account: next.record, sealedKeyring: null },
                old.accountKeys,
                { challenge }
              )
            )
          ).status
        ).toBe(400)
        expect(await reload(user)).toMatchObject(old.columns)

        // The account key without the email link.
        const noLink = await recoveryRequest(token, old.accountKeys, next)
        const forged = JSON.parse(await noLink.text())
        expect(
          (
            await recoveryRoute(
              post(
                '/api/auth/e2ee/recovery',
                { ...forged, token: 'A'.repeat(43) },
                {
                  [SIGNED_REQUEST_CHALLENGE_HEADER]: noLink.headers.get(
                    SIGNED_REQUEST_CHALLENGE_HEADER
                  )!,
                  [SIGNED_REQUEST_SIGNATURE_HEADER]: noLink.headers.get(
                    SIGNED_REQUEST_SIGNATURE_HEADER
                  )!,
                }
              )
            )
          ).status
        ).toBe(400)

        // The owner still recovers with the same link.
        expect(
          (
            await recoveryRoute(
              await recoveryRequest(token, old.accountKeys, next)
            )
          ).status
        ).toBe(200)
        expect(await reload(user)).toMatchObject(next.columns)
      })

      it('resets without the mnemonic: new keys, no keyring, sessions and tokens cancelled', async () => {
        const older = clientKeys()
        const keys = clientKeys()
        const user = await account({
          ...keys.columns,
          sealedKeyring: Uint8Array.from(
            base64urlDecode(keyringOf(keys.accountKeys, [older.accountKeys]))
          ),
        })
        const session = await signIn(user)
        state.session = null
        await prisma.apiToken.create({
          data: {
            userId: user.id,
            name: 'one',
            hash: randomUUID(),
            scopes: [],
          },
        })
        // An encrypted file, a folder with keys and a sealed tag of the old
        // keys, and a plain file (section 6.9, steps 4 and 5).
        const folder = await prisma.vaultFolder.create({
          data: {
            id: 'reset-folder',
            userId: user.id,
            name: '',
            normalizedName: '/sealed/reset-folder',
            shareToken: 'a-share-token-of-a-keyed-folder',
            folderPublicKey: new Uint8Array(32).fill(9),
            sealedFolderMetadata: new Uint8Array(60).fill(1),
            sealedFolderPrivateKey: new Uint8Array(89).fill(1),
          },
        })
        const tag = await prisma.vaultTag.create({
          data: {
            id: 'reset-tag',
            userId: user.id,
            name: '',
            normalizedName: '/sealed/reset-tag',
            sealedTagMetadata: new Uint8Array(60).fill(1),
          },
        })
        const file = (name: string, encrypted: boolean) =>
          prisma.file.create({
            data: {
              userId: user.id,
              name: encrypted ? '' : name,
              urlPath: `/${user.urlId}/${name}`,
              path: `uploads/${name}`,
              mimeType: encrypted ? 'application/octet-stream' : 'text/plain',
              size: 1,
              folderId: folder.id,
              ...(encrypted && {
                encrypted: true,
                header: new Uint8Array(26).fill(1),
                sealedMetadata: new Uint8Array(60).fill(1),
                accountStanza: new Uint8Array(97).fill(1),
                stanzaAccountPublicKey: keys.columns.accountPublicKey,
                thumbnailPending: true,
              }),
            },
          })
        const secret = await file('secret', true)
        const plain = await file('plain.txt', false)
        const next = clientKeys()
        const { token } = await resetLink(user)
        for (const body of [
          { token, account: next.record, passphrase: 'never sent' },
          { token, account: next.record, sealedKeyring: null },
          { token, account: { ...next.record, protocolVersion: 2 } },
          { token: 'not-a-link', account: next.record },
        ])
          expect(
            (await resetRoute(post('/api/auth/e2ee/reset', body))).status
          ).toBe(400)
        expect(await reload(user)).toMatchObject(keys.columns)

        const response = await resetRoute(
          post('/api/auth/e2ee/reset', { token, account: next.record })
        )
        expect(response.status).toBe(200)
        const saved = await reload(user)
        expect(saved).toMatchObject(next.columns)
        expect(saved.sealedKeyring).toBeNull()
        expect(saved.sessionVersion).toBe(user.sessionVersion + 1)
        expect(saved.uploadTokenHash).toBeNull()
        expect(await prisma.apiToken.count()).toBe(0)
        // No key of the account opens the encrypted file now. It is marked,
        // stays where it was, and waits for no work. The plain file is as it
        // was.
        expect(
          await prisma.file.findUniqueOrThrow({ where: { id: secret.id } })
        ).toMatchObject({
          unreadable: true,
          thumbnailPending: false,
          folderId: folder.id,
        })
        expect(
          await prisma.file.findUniqueOrThrow({ where: { id: plain.id } })
        ).toMatchObject({ unreadable: false, name: 'plain.txt' })
        // The sealed names are lost with the old key: the folder and the tag
        // get placeholder names and no keys, and the folder link stops.
        const resetFolder = await prisma.vaultFolder.findUniqueOrThrow({
          where: { id: folder.id },
        })
        expect(resetFolder).toMatchObject({
          folderPublicKey: null,
          sealedFolderPrivateKey: null,
          shareToken: null,
        })
        expect(resetFolder.name).toMatch(/^Folder /)
        const resetTag = await prisma.vaultTag.findUniqueOrThrow({
          where: { id: tag.id },
        })
        expect(resetTag.sealedTagMetadata).toBeNull()
        expect(resetTag.name).toMatch(/^Tag /)
        await expect(
          validateBrowserSession(
            user.id,
            session.user.sessionId,
            saved.sessionVersion
          )
        ).rejects.toThrow('Session invalidated')
        // One use.
        expect(
          (
            await resetRoute(
              post('/api/auth/e2ee/reset', {
                token,
                account: clientKeys().record,
              })
            )
          ).status
        ).toBe(400)
        expect(
          await passphraseSignIn(
            await credentials(user.email!, next.passphraseKeys)
          )
        ).toMatchObject({ id: user.id })
      })

      it('keeps the second factor of the account after a reset', async () => {
        const totp = createTotp()
        const { user } = await keyedAccount({
          totpSecret: encryptTotp(totp.secret.base32),
        })
        const next = clientKeys()
        const { token } = await resetLink(user)
        expect(
          (
            await resetRoute(
              post('/api/auth/e2ee/reset', { token, account: next.record })
            )
          ).status
        ).toBe(200)
        await expect(
          passphraseSignIn(await credentials(user.email!, next.passphraseKeys))
        ).rejects.toThrow('TwoFactorRequired')
      })

      it('gives keys to an account from before encryption, and deletes its password hash', async () => {
        const legacy = await legacyAccount()
        const next = clientKeys()
        const { token } = await resetLink(legacy)
        expect(
          (
            await resetRoute(
              post('/api/auth/e2ee/reset', { token, account: next.record })
            )
          ).status
        ).toBe(200)
        const saved = await reload(legacy)
        expect(saved.password).toBeNull()
        expect(saved).toMatchObject(next.columns)
        expect(
          await passwordSignIn({ email: legacy.email!, password: PASSWORD })
        ).toBeNull()
      })

      it('never gives a local secret to an account that has none', async () => {
        const ssoOnly = await account({ oidcSubject: 'issuer|subject' })
        const { token } = await resetLink(ssoOnly)
        expect(
          (
            await resetRoute(
              post('/api/auth/e2ee/reset', {
                token,
                account: clientKeys().record,
              })
            )
          ).status
        ).toBe(400)
        expect((await reload(ssoOnly)).authPublicKey).toBeNull()
      })

      it('does not set a password by email for an account that has keys', async () => {
        const { user, keys } = await keyedAccount()
        const { token } = await resetLink(user)
        const response = await legacyResetRoute(
          post('/api/auth/email/reset', { token, password: 'new-password-1' })
        )
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({
          code: 'passphrase_account',
        })
        const saved = await reload(user)
        expect(saved.password).toBeNull()
        expect(saved).toMatchObject(keys.columns)
        expect(saved.sessionVersion).toBe(user.sessionVersion)
        // The link is still good for the passphrase reset.
        expect(
          (
            await resetRoute(
              post('/api/auth/e2ee/reset', {
                token,
                account: clientKeys().record,
              })
            )
          ).status
        ).toBe(200)

        // An account from before encryption still can.
        const legacy = await legacyAccount()
        const legacyLink = await resetLink(legacy)
        expect(
          (
            await legacyResetRoute(
              post('/api/auth/email/reset', {
                token: legacyLink.token,
                password: 'new-password-1',
              })
            )
          ).status
        ).toBe(200)
        expect(
          await compare('new-password-1', (await reload(legacy)).password!)
        ).toBe(true)
      })
    })

    describe('passwords of accounts that have keys', () => {
      async function administrator() {
        const admin = await keyedAccount()
        const roles = await prisma.$transaction((tx) => ensureBuiltInRoles(tx))
        await prisma.user.update({
          where: { id: admin.user.id },
          data: { roles: { connect: { id: roles.administrator.id } } },
        })
        return admin.user
      }

      it('refuses an administrator who sets a password for an account with keys', async () => {
        const admin = await administrator()
        const { user, keys } = await keyedAccount()
        const legacy = await legacyAccount()
        await signIn(admin)
        const put = (body: unknown) =>
          usersRoute(post('/api/users', body, {}, 'PUT'))

        const response = await put({ id: user.id, password: 'new-password-1' })
        expect(response.status).toBe(409)
        const answer = await response.json()
        expect(answer.code).toBe('passphrase_account')
        expect(answer.error).toMatch(/cannot set a password/)
        const saved = await reload(user)
        expect(saved.password).toBeNull()
        expect(saved).toMatchObject(keys.columns)
        expect(saved.sessionVersion).toBe(user.sessionVersion)
        // The rest of the form still saves.
        expect((await put({ id: user.id, name: 'Renamed' })).status).toBe(200)
        expect((await reload(user)).name).toBe('Renamed')

        // An account still on the old path keeps this.
        expect(
          (await put({ id: legacy.id, password: 'new-password-1' })).status
        ).toBe(200)
        expect(
          await compare('new-password-1', (await reload(legacy)).password!)
        ).toBe(true)
      })

      it('refuses a password change in the profile for an account with keys', async () => {
        const { user, keys } = await keyedAccount()
        await signIn(user)
        const response = await profileRoute(
          post(
            '/api/profile',
            { currentPassword: PASSWORD, newPassword: 'new-password-1' },
            {},
            'PUT'
          )
        )
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({
          code: 'passphrase_account',
        })
        const saved = await reload(user)
        expect(saved.password).toBeNull()
        expect(saved).toMatchObject(keys.columns)

        // An account still on the old path keeps this.
        const legacy = await legacyAccount()
        await signIn(legacy, 'credentials')
        expect(
          (
            await profileRoute(
              post(
                '/api/profile',
                { currentPassword: PASSWORD, newPassword: 'new-password-1' },
                {},
                'PUT'
              )
            )
          ).status
        ).toBe(200)
        expect(
          await compare('new-password-1', (await reload(legacy)).password!)
        ).toBe(true)
      })
    })

    it('proves identity for a security change with a recent passphrase sign-in', async () => {
      const { user } = await keyedAccount()
      const recent = await signIn(user, 'passphrase')
      const setup = await setupTotp(recent, {})
      expect(setup.secret).toMatch(/^[A-Z2-7]+$/)
      const stale = await signIn(user, 'passphrase', Date.now() - 6 * 60_000)
      await expect(setupTotp(stale, {})).rejects.toThrow(
        /Sign in again with your passphrase/
      )
      // A password in the request proves nothing for an account without one.
      await expect(setupTotp(stale, { password: PASSWORD })).rejects.toThrow(
        /Sign in again with your passphrase/
      )
      const sso = await signIn(user, 'oidc')
      await expect(setupTotp(sso, {})).rejects.toThrow(
        /Sign in again with your passphrase/
      )
    })

    it('never signs with a key the test did not mean to use', () => {
      // Guards the helpers above: a signature by the wrong key must differ.
      const a = clientKeys()
      const b = clientKeys()
      const message = new Uint8Array(8)
      expect(ed25519Sign(a.passphraseKeys.authPrivateKey, message)).not.toEqual(
        ed25519Sign(b.passphraseKeys.authPrivateKey, message)
      )
    })
  }
)
