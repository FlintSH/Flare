import { Prisma, UserRole } from '@prisma/client'
import { compare } from 'bcryptjs'
import { NextAuthOptions, Session, getServerSession } from 'next-auth'
import { JWT } from 'next-auth/jwt'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { OAuthConfig } from 'next-auth/providers/oauth'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'

import { OidcProfile, resolveOidcUser } from './oidc-resolve-user'

const userSelect = {
  id: true,
  email: true,
  name: true,
  password: true,
  role: true,
  image: true,
  sessionVersion: true,
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
} as const

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      image: string | null
      role: UserRole
      emailAccessRequired?: boolean
      authTime?: number
      authMethod?: string
    }
  }

  interface User {
    role?: UserRole
    sessionVersion?: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole
    sessionVersion: number
    name?: string | null
    email?: string | null
    image?: string | null
    emailAccessRequired?: boolean
    authTime?: number
    authMethod?: string
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email,
          },
          select: userSelect,
        })

        if (!user?.password) {
          return null
        }

        const isPasswordValid = await compare(
          credentials.password,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.image,
          sessionVersion: user.sessionVersion,
        }
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
        return `/auth/login?error=${oidcErrorParams[result.reason]}`
      }

      Object.assign(user, result.user)
      return true
    },
    async jwt({ token, user, account }): Promise<JWT> {
      if (user) {
        const sessionUser = user as UserWithSession
        token.id = sessionUser.id
        token.role = sessionUser.role
        token.image = sessionUser.image
        token.sessionVersion = sessionUser.sessionVersion
        token.name = sessionUser.name
        token.email = sessionUser.email
        token.authTime = Date.now()
        token.authMethod = account?.provider || 'credentials'
      }

      const freshUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: userSelect,
      })

      if (!freshUser) {
        throw new Error('Session invalidated: User not found')
      }

      if (
        token.sessionVersion &&
        token.sessionVersion !== freshUser.sessionVersion
      ) {
        throw new Error('Session invalidated: Version mismatch')
      }

      token.role = freshUser.role
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
        session.user.id = token.id
        session.user.role = token.role
        session.user.image = token.image || null
        session.user.name = token.name || ''
        session.user.email = token.email || ''
        session.user.emailAccessRequired = token.emailAccessRequired
        session.user.authTime = token.authTime
        session.user.authMethod = token.authMethod
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/login',
    newUser: '/auth/register',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
}

/** Normal application access; email management uses the restricted session directly. */
export async function getAccessSession() {
  const session = await getServerSession(authOptions)
  return session?.user?.emailAccessRequired ? null : session
}

function trimTrailingSlashes(value: string) {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') {
    end -= 1
  }
  return value.slice(0, end)
}

/**
 * OIDC `sub` is only unique within its issuer, not globally, so it must be
 * scoped before being used as a global lookup key (see oidcSubject on User).
 */
function scopeOidcSubject(issuer: string, sub: string): string {
  return `${trimTrailingSlashes(issuer)}|${sub}`
}

interface OidcRawProfile extends Record<string, unknown> {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

interface OidcSettings {
  enabled: boolean
  issuer: string
  clientId: string
  clientSecret: string
  buttonText: string
}

export function isOidcProviderConfigured(oidc: OidcSettings) {
  return Boolean(
    oidc.enabled && oidc.issuer && oidc.clientId && oidc.clientSecret
  )
}

function buildOidcProvider(oidc: OidcSettings): OAuthConfig<OidcRawProfile> {
  return {
    id: 'oidc',
    name: oidc.buttonText || 'SSO',
    type: 'oauth',
    wellKnown: `${trimTrailingSlashes(oidc.issuer)}/.well-known/openid-configuration`,
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
