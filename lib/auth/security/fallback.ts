import type { Prisma, User } from '@prisma/client'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'

/** A configured fallback is a local check, not a guarantee of IdP availability. */
export async function hasFallbackSignIn(
  tx: Prisma.TransactionClient,
  user: User
) {
  if (user.password && user.email) return true
  // The OIDC callback rejects accounts with local TOTP enrollment.
  if (!user.oidcSubject || user.totpSecret) return false
  const record = await tx.config.findUnique({ where: { key: 'flare_config' } })
  const oidc = configSchema.parse(record?.value ?? DEFAULT_CONFIG).settings
    .general.oidc
  const issuer = oidc.issuer.replace(/\/+$/, '')
  return Boolean(
    oidc.enabled &&
    issuer &&
    oidc.clientId &&
    oidc.clientSecret &&
    user.oidcSubject.startsWith(`${issuer}|`)
  )
}
