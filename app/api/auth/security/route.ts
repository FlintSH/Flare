import { securityRoutes, securitySession } from '@/lib/auth/security/http'
import { recentAuthentication } from '@/lib/auth/security/service'
import { relyingParty } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security', securityRoutes)

export const GET = api(async (request) => {
  const { session, user } = await securitySession(request, false)
  const [passkeys, recoveryCodesRemaining, passkeyRecoveryCodesRemaining] =
    await Promise.all([
      prisma.passkey.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, createdAt: true, lastUsedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.recoveryCode.count({ where: { userId: user.id } }),
      prisma.passkeyRecoveryCode.count({ where: { userId: user.id } }),
    ])
  let passkeysAvailable = true
  try {
    relyingParty()
  } catch {
    passkeysAvailable = false
  }
  return {
    twoFactorEnabled: Boolean(user.totpSecret),
    recoveryCodesRemaining,
    passkeyRequired: user.passkeyRequired,
    passkeyRecoveryCodesRemaining,
    hasPassword: Boolean(user.password),
    passkeys,
    passkeysAvailable,
    canUseRecentPasskey: recentAuthentication(session, 'passkey'),
    canUseRecentRecovery: recentAuthentication(session, 'recovery'),
    canUseRecentPasskeyRecovery: recentAuthentication(
      session,
      'passkey-recovery'
    ),
    canUseRecentSso: !user.password && recentAuthentication(session, 'oidc'),
  }
})
