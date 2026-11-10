import { createHash } from 'node:crypto'

import type { FlareConfig } from '@/lib/config'

import { UPLOAD_DEFAULTS, type UploadProfileOptions } from './schema'

export function accountUploadOptions(
  account: {
    randomizeFileUrls: boolean
    defaultFileExpiration: NonNullable<UploadProfileOptions['expiration']>
    defaultFileExpirationAction: NonNullable<
      UploadProfileOptions['expiryAction']
    >
  },
  config: FlareConfig
): UploadProfileOptions {
  return {
    shareStyle: config.settings.customization.published.sharing.defaultStyle,
    randomizeFileUrls: account.randomizeFileUrls,
    expiration: account.defaultFileExpiration,
    expiryAction: account.defaultFileExpirationAction,
  }
}

/** Hash exactly the reviewable settings, excluding the clock-derived deadline. */
export function effectiveUploadRevision(
  userId: string,
  profileId: string,
  account: UploadProfileOptions,
  profile: UploadProfileOptions,
  canShare: boolean
) {
  const effective = { ...UPLOAD_DEFAULTS, ...account, ...profile }
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        userId,
        profileId,
        visibility: canShare ? effective.visibility : 'PRIVATE',
        expiration: effective.expiration,
        expiryAction: effective.expiryAction,
        randomizeFileUrls: effective.randomizeFileUrls,
        shareStyle: effective.shareStyle,
        tagIds: [...new Set(effective.tagIds)].sort(),
        // Only a plain profile adds the field, so the revision of each
        // profile from before this setting stays the same.
        ...(effective.encryption === 'plain' && { encryption: 'plain' }),
      })
    )
    .digest('hex')
}
