import { UserRole } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { lockEmailAddress } from '@/lib/email/account'
import { createUser } from '@/lib/users/create-user'

export interface OidcProfile {
  sub: string
  email?: string | null
  email_verified?: boolean | null
  name?: string | null
  picture?: string | null
}

export interface OidcConfig {
  autoProvision: boolean
  requireEmailVerified: boolean
  trustEmail?: boolean
  emailEnabled?: boolean
}

export interface ResolvedOidcUser {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  sessionVersion: number
}

export type OidcResolveResult =
  | { ok: true; user: ResolvedOidcUser }
  | {
      ok: false
      reason:
        | 'no_email'
        | 'account_exists'
        | 'not_provisioned'
        | 'email_unverified'
    }

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  image: true,
  sessionVersion: true,
} as const

export async function resolveOidcUser(
  profile: OidcProfile,
  config: OidcConfig
): Promise<OidcResolveResult> {
  const existingBySubject = await prisma.user.findUnique({
    where: { oidcSubject: profile.sub },
    select: userSelect,
  })

  if (existingBySubject) {
    if (
      config.trustEmail &&
      profile.email_verified === true &&
      profile.email === existingBySubject.email
    ) {
      await prisma.user.update({
        where: { id: existingBySubject.id },
        data: {
          emailVerified: new Date(),
          emailVerifiedFor: existingBySubject.email,
          emailVerificationSource: 'oidc',
        },
      })
    }
    return { ok: true, user: toResolvedUser(existingBySubject) }
  }

  if (!profile.email) {
    return { ok: false, reason: 'no_email' }
  }

  if (config.requireEmailVerified && profile.email_verified !== true) {
    return { ok: false, reason: 'email_unverified' }
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: profile.email },
    select: userSelect,
  })

  if (existingByEmail) {
    // A verified IdP email proves neither ownership of the local account nor
    // continuity with its existing SSO identity. Linking needs a separate flow
    // that authenticates both accounts; never attach or replace a subject here.
    return { ok: false, reason: 'account_exists' }
  }

  if (!config.autoProvision) {
    return { ok: false, reason: 'not_provisioned' }
  }

  const created = await prisma.$transaction(async (tx) => {
    if (config.emailEnabled) {
      await lockEmailAddress(tx, profile.email as string)
      if (
        await tx.user.findFirst({
          where: {
            email: { equals: profile.email as string, mode: 'insensitive' },
          },
        })
      )
        return null
    }
    return createUser(tx, {
      email: profile.email as string,
      name: profile.name || profile.email!.split('@')[0],
      image: profile.picture,
      oidcSubject: profile.sub,
      emailVerified: profile.email_verified === true ? new Date() : undefined,
      ...(config.trustEmail && profile.email_verified === true
        ? {
            emailVerifiedFor: profile.email as string,
            emailVerificationSource: 'oidc',
          }
        : {}),
    })
  })

  if (!created) return { ok: false, reason: 'account_exists' }

  return { ok: true, user: toResolvedUser(created) }
}

function toResolvedUser(user: {
  id: string
  email: string | null
  name: string | null
  role: UserRole
  image: string | null
  sessionVersion: number
}): ResolvedOidcUser {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || '',
    image: user.image,
    role: user.role,
    sessionVersion: user.sessionVersion,
  }
}
