import { format } from 'date-fns'

import type { UploadProfileOptions } from './schema'

export type UploadSummaryOverrides = {
  visibility?: 'PUBLIC' | 'PRIVATE'
  password?: boolean
  passwordInvalid?: boolean
  expiresAt?: Date | null
  expiryAction?: 'DELETE' | 'SET_PRIVATE'
}

/** Describe the same precedence as mergeUploadOptions, without exposing a
 * password. This remains visible while optional creation fields are closed. */
export function uploadSettingsSummary(
  effective: Required<UploadProfileOptions>,
  canShare: boolean,
  overrides: UploadSummaryOverrides = {}
): string {
  const visibility =
    !canShare || (overrides.visibility ?? effective.visibility) === 'PRIVATE'
      ? 'Private'
      : 'Public (anyone with the link)'
  const action =
    (overrides.expiryAction ?? effective.expiryAction) === 'SET_PRIVATE'
      ? 'make private'
      : 'permanently delete'
  const duration = {
    HOUR: '1 hour',
    DAY: '1 day',
    WEEK: '1 week',
    MONTH: '1 month',
  }
  const expiration = overrides.expiresAt
    ? `${format(overrides.expiresAt, 'PP p')}, then ${action}`
    : overrides.expiresAt === null || effective.expiration === 'DISABLED'
      ? 'no expiry'
      : `${duration[effective.expiration]}, then ${action}`
  return [
    visibility,
    ...(canShare && overrides.password
      ? [
          overrides.passwordInvalid
            ? 'password needs attention'
            : 'password protected',
        ]
      : []),
    expiration,
    effective.randomizeFileUrls ? 'random filenames' : 'original filenames',
  ].join(' · ')
}
