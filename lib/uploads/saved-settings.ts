import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import { accountUploadOptions } from './effective-settings'
import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
  uploadProfileOptionsSchema,
} from './schema'

/** A folder a link to Upload names, if it is the account's. */
export async function ownFolder(userId: string, id: string | null) {
  if (!id) return null
  return prisma.vaultFolder.findFirst({
    where: { id, userId },
    select: { id: true, name: true },
  })
}

export type SavedUploadSettings = {
  /** The account's settings with its default profile's over them. */
  effective: Required<UploadProfileOptions>
  /** The account's settings alone, as an upload with no profile gets. */
  account: Required<UploadProfileOptions>
  /** The default profile, or null when the account's own settings apply. */
  profile: { id: string; name: string } | null
  /**
   * Whether the account has profiles, folders and tags to choose from, so
   * the options row has its final shape before those lists load.
   */
  has: { profiles: boolean; folders: boolean; tags: boolean }
}

/**
 * What an upload that picks nothing gets, merged as uploads merge it. Pages
 * show it to every role, including roles that can't list upload profiles.
 */
export async function savedUploadSettings(
  userId: string
): Promise<SavedUploadSettings | null> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      randomizeFileUrls: true,
      defaultFileExpiration: true,
      defaultFileExpirationAction: true,
      defaultUploadProfileId: true,
    },
  })
  if (!account) return null
  const own = {
    ...UPLOAD_DEFAULTS,
    ...accountUploadOptions(account, await getConfig()),
  }
  const [profile, profiles, folders, tags] = await Promise.all([
    account.defaultUploadProfileId
      ? prisma.uploadProfile.findFirst({
          where: { id: account.defaultUploadProfileId, userId },
          select: { id: true, name: true, options: true },
        })
      : null,
    prisma.uploadProfile.count({ where: { userId } }),
    prisma.vaultFolder.count({ where: { userId } }),
    prisma.vaultTag.count({ where: { userId } }),
  ])
  return {
    effective: {
      ...own,
      ...(profile ? uploadProfileOptionsSchema.parse(profile.options) : {}),
    },
    account: own,
    profile: profile && { id: profile.id, name: profile.name },
    has: { profiles: profiles > 0, folders: folders > 0, tags: tags > 0 },
  }
}
