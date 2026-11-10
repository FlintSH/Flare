import type { Prisma, User } from '@prisma/client'

import { readConfig } from '@/lib/config'
import { oidcSubjectPrefix } from '@/lib/config/oidc'

/** A configured fallback is a local check, not a guarantee of IdP availability. */
export async function hasFallbackSignIn(
  tx: Prisma.TransactionClient,
  user: User
) {
  // A local secret: a password hash, or the sign-in key of a passphrase.
  if ((user.password || user.authPublicKey) && user.email) return true
  // The OIDC callback rejects accounts with local TOTP enrollment.
  if (!user.oidcSubject || user.totpSecret) return false
  const prefix = oidcSubjectPrefix((await readConfig(tx)).settings.general.oidc)
  return Boolean(prefix && user.oidcSubject.startsWith(prefix))
}
