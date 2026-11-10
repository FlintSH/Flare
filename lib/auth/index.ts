import { headers } from 'next/headers'

import { type User as AccountRow, Prisma } from '@prisma/client'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { compare } from 'bcryptjs'
import { NextAuthOptions, Session, getServerSession } from 'next-auth'
import { JWT } from 'next-auth/jwt'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { OAuthConfig } from 'next-auth/providers/oauth'

import { setAuditActor } from '@/lib/audit'
import { type FlareConfig, getConfig } from '@/lib/config'
import {
  isOidcProviderConfigured,
  oidcIssuer,
  scopeOidcSubject,
} from '@/lib/config/oidc'
import { prisma } from '@/lib/database/prisma'
import { normalizeIdentifier } from '@/lib/e2ee'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import type { Permission, RoleSummary } from '@/lib/permissions/catalog'
import { getUserAccess } from '@/lib/permissions/server'
import { clientIp, headerRecord } from '@/lib/security/client-ip'

import {
  IDENTIFIER_MAX_LENGTH,
  findAccountByIdentifier,
  verifyAuthKeyProof,
} from './e2ee/accounts'
import { challengeField, sameBytes, signatureField } from './e2ee/records'
import {
  OidcProfile,
  type OidcResolveResult,
  resolveOidcUser,
} from './oidc-resolve-user'
import {
  authenticatePasskey,
  readPasskeyChallengeCookie,
} from './security/passkeys'
import { SECURITY_CODE_MAX_LENGTH } from './security/policy'
import { authenticatePasskeyRecovery } from './security/required-passkeys'
import { consumeSecondFactor } from './security/service'
import {
  SecurityError,
  lockSecurityUser,
  securityLimit,
} from './security/shared'
import {
  BROWSER_SESSION_SECONDS,
  createBrowserSession,
  loginMetadata,
  recordFailedLogin,
  signOutBrowserSession,
  validateBrowserSession,
} from './sessions'
import {
  type OidcError,
  SIGN_IN_PATH,
  SignInError,
  oidcErrorPath,
} from './sign-in'

const userSelect = {
  id: true,
  email: true,
  name: true,
  password: true,
  authPublicKey: true,
  image: true,
  sessionVersion: true,
  passkeyRequired: true,
  emailVerified: true,
  emailVerifiedFor: true,
  emailVerificationSource: true,
  emailExempt: true,
  createdAt: true,
} as const

type UserWithSession = Prisma.UserGetPayload<{ select: typeof userSelect }>

const oidcErrorParams = {
  no_email: 'OidcNoEmail',
  account_exists: 'OidcAccountExists',
  not_provisioned: 'OidcNotProvisioned',
  email_unverified: 'OidcEmailUnverified',
} satisfies Record<
  Extract<OidcResolveResult, { ok: false }>['reason'],
  OidcError
>

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      image: string | null
      roles: RoleSummary[]
      permissions: Permission[]
      emailAccessRequired?: boolean
      authTime?: number
      authMethod?: string
      sessionVersion?: number
      sessionId?: string
    }
  }

  interface User {
    sessionVersion?: number
    /** Server-only evidence returned by the credentials authorizer. */
    authenticationMethod?: 'recovery'
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    sessionVersion: number
    sessionId?: string
    sessionExpiresAt?: string
    name?: string | null
    email?: string | null
    image?: string | null
    emailAccessRequired?: boolean
    authTime?: number
    authMethod?: string
  }
}

function reports(error: unknown, ...codes: SignInError[]) {
  return error instanceof Error && (codes as string[]).includes(error.message)
}

function passkeyAttemptId(response?: string) {
  if (!response || response.length > 65536) return undefined
  try {
    const id = JSON.parse(response).id
    return typeof id === 'string' && id.length <= 2048 ? id : undefined
  } catch {
    return undefined
  }
}

async function trackLoginAttempt<T>(
  method: string,
  requestHeaders: RequestHeaders,
  identity: { email?: string; passkeyId?: string; userId?: string },
  authorize: () => Promise<T>
) {
  try {
    const result = await authorize()
    if (!result)
      await recordFailedLogin(
        method,
        loginMetadata(new Headers(requestHeaders)),
        identity
      )
    return result
  } catch (error) {
    // Asking for the second step is not a failed sign-in. Do not amplify rate-limited traffic into unlimited history writes.
    if (
      !reports(
        error,
        SignInError.TwoFactorRequired,
        SignInError.TooManyAttempts
      )
    ) {
      await recordFailedLogin(
        method,
        loginMetadata(new Headers(requestHeaders)),
        identity
      )
    }
    throw error
  }
}

type RequestHeaders = Record<string, string> | undefined

/** What a credentials authorizer returns for the account that signed in. */
function signedIn(
  user: Pick<AccountRow, 'id' | 'email' | 'name' | 'image' | 'sessionVersion'>,
  secondFactor?: 'totp' | 'recovery'
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    sessionVersion: user.sessionVersion,
    ...(secondFactor === 'recovery'
      ? { authenticationMethod: 'recovery' as const }
      : {}),
  }
}

/**
 * The steps that the password sign-in and the passphrase sign-in share, so
 * that neither can be weaker than the other: the attempt limits for the
 * client address and for the account, then `prove`, the first factor of
 * that sign-in, then the second factor with the account row locked.
 *
 * `prove` returns the account, and `unchanged` says whether a row is still
 * the account that the proof was about. A proof that raced a change of the
 * secret, of the address or of the session version signs nobody in.
 */
async function localSignIn(
  requestHeaders: RequestHeaders,
  account: string,
  code: string | undefined,
  prove: () => Promise<{
    id: string
    unchanged: (fresh: AccountRow) => boolean
  } | null>
) {
  try {
    const ip = clientIp(headerRecord(requestHeaders)) ?? 'unknown'
    await securityLimit(`password-ip:${ip}`, 100)
    await securityLimit(`password-account:${account}`, 30)
    const proven = await prove()
    if (!proven) return null
    return await prisma.$transaction(async (tx) => {
      const fresh = await lockSecurityUser(tx, proven.id)
      if (!proven.unchanged(fresh)) return null
      if (fresh.passkeyRequired) throw new Error(SignInError.PasskeyRequired)
      if (fresh.totpSecret && !code)
        throw new Error(SignInError.TwoFactorRequired)
      return signedIn(fresh, await consumeSecondFactor(tx, fresh, code))
    })
  } catch (error) {
    if (
      reports(error, SignInError.TwoFactorRequired, SignInError.PasskeyRequired)
    )
      throw error
    if (error instanceof SecurityError && error.status === 429)
      throw new Error(SignInError.TooManyAttempts)
    return null
  }
}

/** A text field of a credentials form as `schema` reads it, or null. */
function credentialBytes(
  schema: typeof challengeField | typeof signatureField,
  text: string
) {
  const parsed = schema.safeParse(text)
  return parsed.success ? parsed.data : null
}

export const authOptions: NextAuthOptions = {
  providers: [
    // Password sign-in, for an account from before encryption until it
    // completes key setup (docs/e2ee-spec.md, section 14.1). Key setup deletes
    // the password hash, and this provider then refuses the account.
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        code: { label: 'Authenticator or recovery code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        if (
          credentials.email.length > 320 ||
          credentials.password.length > 256 ||
          (credentials.code?.length || 0) > SECURITY_CODE_MAX_LENGTH
        )
          return null
        return trackLoginAttempt(
          'credentials',
          req.headers,
          { email: credentials?.email },
          () =>
            localSignIn(
              req.headers,
              credentials.email.trim().toLowerCase(),
              credentials.code,
              async () => {
                const user = await prisma.user.findUnique({
                  where: { email: credentials.email },
                  select: userSelect,
                })
                if (
                  !user?.password ||
                  user.authPublicKey ||
                  !(await compare(credentials.password, user.password))
                )
                  return null
                return {
                  id: user.id,
                  unchanged: (fresh) =>
                    fresh.password === user.password &&
                    !fresh.authPublicKey &&
                    fresh.email === user.email &&
                    fresh.sessionVersion === user.sessionVersion,
                }
              }
            )
        )
      },
    }),
    // Passphrase sign-in (docs/e2ee-spec.md, section 6.2, steps 4 to 8). The
    // passphrase never arrives here. The client proves it with a signature
    // of the sign-in key on a challenge of `POST /api/auth/e2ee/challenge`.
    // The session is the only result: the unlock route releases the key
    // material, for its own signature.
    CredentialsProvider({
      id: 'passphrase',
      name: 'Passphrase',
      credentials: {
        identifier: { label: 'Email', type: 'email' },
        challenge: { label: 'Challenge', type: 'text' },
        signature: { label: 'Sign-in signature', type: 'text' },
        code: { label: 'Authenticator or recovery code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (
          !credentials?.identifier ||
          !credentials.challenge ||
          !credentials.signature ||
          credentials.identifier.length > IDENTIFIER_MAX_LENGTH ||
          (credentials.code?.length || 0) > SECURITY_CODE_MAX_LENGTH
        )
          return null
        const challenge = credentialBytes(challengeField, credentials.challenge)
        const signature = credentialBytes(signatureField, credentials.signature)
        if (!challenge || !signature) return null
        // Filled in when the identifier names an account, for the history.
        const identity: { userId?: string } = {}
        return trackLoginAttempt('passphrase', req.headers, identity, () =>
          localSignIn(
            req.headers,
            normalizeIdentifier(credentials.identifier),
            credentials.code,
            async () => {
              const user = await findAccountByIdentifier(
                prisma,
                credentials.identifier
              )
              identity.userId = user?.id
              // Step 5: the challenge is deleted before anything is
              // verified, also for an identifier that names no account.
              if (
                !(await verifyAuthKeyProof(
                  'sign-in',
                  { challenge, signature },
                  'e2ee_sign_in',
                  // Not bound to a session version: no session exists yet.
                  user && { ...user, sessionVersion: undefined }
                )) ||
                !user
              )
                return null
              return {
                id: user.id,
                unchanged: (fresh) =>
                  sameBytes(fresh.authPublicKey, user.authPublicKey) &&
                  fresh.email === user.email &&
                  fresh.sessionVersion === user.sessionVersion,
              }
            }
          )
        )
      },
    }),
    CredentialsProvider({
      id: 'passkey',
      name: 'Passkey',
      credentials: {
        challengeId: { label: 'Challenge', type: 'text' },
        response: { label: 'Passkey response', type: 'text' },
        expectedUserId: { label: 'Account being confirmed', type: 'text' },
      },
      async authorize(credentials, req) {
        if (
          !credentials?.challengeId ||
          !credentials.response ||
          credentials.challengeId.length > 100 ||
          credentials.response.length > 65536 ||
          (credentials.expectedUserId?.length || 0) > 128
        )
          return null
        return trackLoginAttempt(
          'passkey',
          req.headers,
          { passkeyId: passkeyAttemptId(credentials?.response) },
          async () => {
            try {
              const ip = clientIp(headerRecord(req.headers)) ?? 'unknown'
              await securityLimit(`passkey-login:${ip}`, 100)
              const binding = readPasskeyChallengeCookie(req.headers?.cookie)
              const user = await authenticatePasskey(
                credentials.challengeId,
                JSON.parse(credentials.response) as AuthenticationResponseJSON,
                binding,
                credentials.expectedUserId
              )
              return {
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
                sessionVersion: user.sessionVersion,
              }
            } catch (error) {
              if (error instanceof SecurityError && error.status === 429)
                throw new Error(SignInError.TooManyAttempts)
              return null
            }
          }
        )
      },
    }),
    CredentialsProvider({
      id: 'passkey-recovery',
      name: 'Passkey recovery',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Passkey recovery code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (
          !credentials?.email ||
          !credentials.code ||
          credentials.email.length > 320 ||
          credentials.code.length > SECURITY_CODE_MAX_LENGTH
        )
          return null
        return trackLoginAttempt(
          'passkey-recovery',
          req.headers,
          { email: credentials?.email?.trim() },
          async () => {
            try {
              const ip = clientIp(headerRecord(req.headers)) ?? 'unknown'
              await securityLimit(`passkey-recovery-ip:${ip}`, 100)
              await securityLimit(
                `passkey-recovery-account:${credentials.email.trim().toLowerCase()}`,
                30
              )
              const user = await authenticatePasskeyRecovery(
                credentials.email.trim(),
                credentials.code
              )
              if (!user) return null
              return {
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
                sessionVersion: user.sessionVersion,
              }
            } catch (error) {
              if (error instanceof SecurityError && error.status === 429)
                throw new Error(SignInError.TooManyAttempts)
              return null
            }
          }
        )
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'oidc') {
        return true
      }

      const config = await getConfig()
      const oidcConfig = config.settings.general.oidc
      const emailConfig = await getEmailConfig()
      const rawProfile = profile as OidcProfile
      const scopedProfile: OidcProfile = {
        ...rawProfile,
        sub: scopeOidcSubject(oidcConfig.issuer, rawProfile.sub),
      }

      const result = await resolveOidcUser(scopedProfile, {
        autoProvision: oidcConfig.autoProvision,
        requireEmailVerified: oidcConfig.requireEmailVerified,
        trustEmail: emailConfig.enabled && emailConfig.verification.trustOidc,
        emailEnabled: emailConfig.enabled,
      })

      if (!result.ok) {
        let metadata = { ipAddress: null, userAgent: null } as ReturnType<
          typeof loginMetadata
        >
        try {
          metadata = loginMetadata(await headers())
        } catch {}
        await recordFailedLogin('oidc', metadata, {
          email: scopedProfile.email || undefined,
        })
        return oidcErrorPath(oidcErrorParams[result.reason])
      }

      const security = await prisma.user.findUnique({
        where: { id: result.user.id },
        select: { totpSecret: true, passkeyRequired: true },
      })
      if (security?.passkeyRequired || security?.totpSecret) {
        let metadata = { ipAddress: null, userAgent: null } as ReturnType<
          typeof loginMetadata
        >
        try {
          metadata = loginMetadata(await headers())
        } catch {}
        await recordFailedLogin('oidc', metadata, { userId: result.user.id })
        return oidcErrorPath(
          security.passkeyRequired
            ? 'OidcPasskeyRequired'
            : 'OidcTwoFactorRequired',
          true
        )
      }

      Object.assign(user, result.user)
      return true
    },
    async jwt({ token, user, account }): Promise<JWT> {
      if (user) {
        const sessionUser = user as UserWithSession
        token.id = sessionUser.id
        token.image = sessionUser.image
        token.sessionVersion = sessionUser.sessionVersion
        token.name = sessionUser.name
        token.email = sessionUser.email
        token.authTime = Date.now()
        // Only the authorizer can establish recovery proof. Never accept it
        // from OAuth profile data or a client-triggered session update.
        token.authMethod =
          (account?.provider === 'credentials' ||
            account?.provider === 'passphrase') &&
          user.authenticationMethod === 'recovery'
            ? 'recovery'
            : account?.provider || 'credentials'
        let metadata = { ipAddress: null, userAgent: null } as ReturnType<
          typeof loginMetadata
        >
        try {
          metadata = loginMetadata(await headers())
        } catch {
          /* No HTTP request in service tests. */
        }
        const browserSession = await createBrowserSession(
          token.id,
          token.sessionVersion,
          token.authMethod,
          metadata
        )
        token.sessionId = browserSession.id
      }

      const freshUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: userSelect,
      })

      if (!freshUser) {
        throw new Error('Session invalidated: User not found')
      }

      if (token.sessionVersion !== freshUser.sessionVersion) {
        throw new Error('Session invalidated: Version mismatch')
      }

      if (
        freshUser.passkeyRequired &&
        !['passkey', 'passkey-recovery'].includes(token.authMethod || '')
      ) {
        throw new Error('Session invalidated: Passkey sign-in required')
      }

      const activeSession = await validateBrowserSession(
        token.id,
        token.sessionId,
        token.sessionVersion
      )
      token.sessionExpiresAt = activeSession.expiresAt.toISOString()
      setAuditActor({ id: freshUser.id, name: freshUser.name })

      // Remove obsolete authority from cookies issued before the role migration.
      delete token.role
      token.image = freshUser.image
      token.name = freshUser.name
      token.email = freshUser.email
      token.sessionVersion = freshUser.sessionVersion
      token.emailAccessRequired = requiresEmailVerification(
        freshUser,
        await getEmailConfig()
      )

      return token
    },
    async session({ session, token }): Promise<Session> {
      if (token) {
        if (token.sessionExpiresAt) session.expires = token.sessionExpiresAt
        session.user.id = token.id
        const access = await getUserAccess(token.id)
        session.user.roles = access.roles
        session.user.permissions = access.permissions
        session.user.image = token.image || null
        session.user.name = token.name || ''
        session.user.email = token.email || ''
        session.user.emailAccessRequired = token.emailAccessRequired
        session.user.authTime = token.authTime
        session.user.authMethod = token.authMethod
        session.user.sessionVersion = token.sessionVersion
        session.user.sessionId = token.sessionId
      }
      return session
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.id)
        await signOutBrowserSession(token.id, token.sessionId, token.name)
    },
  },
  pages: {
    signIn: SIGN_IN_PATH,
    newUser: '/auth/register',
  },
  session: {
    strategy: 'jwt',
    maxAge: BROWSER_SESSION_SECONDS,
  },
}

/** Normal application access; email management uses the restricted session directly. */
export async function getAccessSession() {
  const session = await getServerSession(authOptions)
  return session?.user?.emailAccessRequired ? null : session
}

interface OidcRawProfile extends Record<string, unknown> {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

function buildOidcProvider(
  oidc: FlareConfig['settings']['general']['oidc']
): OAuthConfig<OidcRawProfile> {
  return {
    id: 'oidc',
    name: oidc.buttonText || 'SSO',
    type: 'oauth',
    wellKnown: `${oidcIssuer(oidc)}/.well-known/openid-configuration`,
    clientId: oidc.clientId,
    clientSecret: oidc.clientSecret,
    authorization: { params: { scope: 'openid email profile' } },
    idToken: true,
    checks: ['pkce', 'state'],
    async profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? null,
        email: profile.email ?? null,
        image: profile.picture ?? null,
      }
    },
  }
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const config = await getConfig()
  const oidc = config.settings.general.oidc

  const providers = [...authOptions.providers]
  if (isOidcProviderConfigured(oidc)) {
    providers.push(buildOidcProvider(oidc))
  }

  return { ...authOptions, providers }
}
