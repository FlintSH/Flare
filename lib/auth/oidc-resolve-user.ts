import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { createAccount } from '@/lib/users/create-account'

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
  sessionVersion: number
}

export type OidcResolveResult =
  | { ok: true; user: ResolvedOidcUser }
  | {
      ok: false
      reason:
        'no_email' | 'account_exists' | 'not_provisioned' | 'email_unverified'
    }

const userSelect = {
  id: true,
  email: true,
  name: true,
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

  const email = profile.email
  if (!email) {
    return { ok: false, reason: 'no_email' }
  }

  if (config.requireEmailVerified && profile.email_verified !== true) {
    return { ok: false, reason: 'email_unverified' }
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
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
    await lockRoleChanges(tx)
    return createAccount(
      tx,
      {
        email,
        name: profile.name || email.split('@')[0],
        image: profile.picture,
        oidcSubject: profile.sub,
        emailVerified: profile.email_verified === true ? new Date() : undefined,
        ...(config.trustEmail && profile.email_verified === true
          ? { emailVerifiedFor: email, emailVerificationSource: 'oidc' }
          : {}),
      },
      { enabled: config.emailEnabled === true }
    )
  })

  if (!created) return { ok: false, reason: 'account_exists' }

  return { ok: true, user: toResolvedUser(created) }
}

function toResolvedUser(user: {
  id: string
  email: string | null
  name: string | null
  image: string | null
  sessionVersion: number
}): ResolvedOidcUser {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || '',
    image: user.image,
    sessionVersion: user.sessionVersion,
  }
}
