import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import { accountUploadOptions } from './effective-settings'
import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
  uploadProfileOptionsSchema,
} from './schema'

export type SavedUploadSettings = {
  /** The account's settings with its default profile's over them. */
  effective: Required<UploadProfileOptions>
  /** The default profile, or null when the account's own settings apply. */
  profile: { id: string; name: string } | null
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
  const profile = account.defaultUploadProfileId
    ? await prisma.uploadProfile.findFirst({
        where: { id: account.defaultUploadProfileId, userId },
        select: { id: true, name: true, options: true },
      })
    : null
  return {
    effective: {
      ...UPLOAD_DEFAULTS,
      ...accountUploadOptions(account, await getConfig()),
      ...(profile ? uploadProfileOptionsSchema.parse(profile.options) : {}),
    },
    profile: profile && { id: profile.id, name: profile.name },
  }
}
