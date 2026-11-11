import { prisma } from '@/lib/database/prisma'

/**
 * The account upload token from before end-to-end encryption
 * (docs/e2ee-spec.md, section 14.4). Flare stores its SHA-256 only, so
 * nothing here can return the token. A tool that still holds it uploads
 * plain files until the user installs a new configuration and revokes it.
 */
export interface LegacyUploadTokenStatus {
  /** The old token still authenticates. */
  active: boolean
  /** When an upload last used it, to the hour, or null. */
  lastUsedAt: string | null
  /**
   * The account has a usable upload token from after the upgrade, so at
   * least one tool can have a new configuration.
   */
  hasNewConfiguration: boolean
}

export async function legacyUploadTokenStatus(
  userId: string
): Promise<LegacyUploadTokenStatus> {
  const [user, replacements] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { uploadTokenHash: true, uploadTokenUsedAt: true },
    }),
    prisma.apiToken.count({
      where: {
        userId,
        predatesEncryption: false,
        revokedAt: null,
        scopes: { has: 'files:upload' },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
  ])
  const active = Boolean(user?.uploadTokenHash)
  return {
    active,
    lastUsedAt: active
      ? (user?.uploadTokenUsedAt?.toISOString() ?? null)
      : null,
    hasNewConfiguration: replacements > 0,
  }
}

/** Revokes the old token. Each tool that holds it stops uploading. */
export async function revokeLegacyUploadToken(userId: string) {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, uploadTokenHash: { not: null } },
    data: { uploadTokenHash: null, uploadTokenUsedAt: null },
  })
  return count > 0
}
