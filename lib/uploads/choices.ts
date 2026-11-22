/**
 * What someone picks for one upload or paste on top of their saved settings,
 * and what that comes to. The precedence is `mergeUploadOptions`': each choice
 * left unset falls back to the profile, then the account. Browser-safe.
 */
import { format } from 'date-fns'

import type { UploadOptions } from './client'
import type { UploadProfileOptions } from './schema'

export type Visibility = 'PUBLIC' | 'PRIVATE'
export type ExpiryAction = 'DELETE' | 'SET_PRIVATE'
export type RelativeExpiration = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH'

/** When files expire: never, a time after each arrives, or a set moment. */
export type Expiry =
  | { kind: 'never' }
  | { kind: 'after'; after: RelativeExpiration }
  | { kind: 'at'; at: Date }

export type UploadChoices = {
  /** Undefined: the account's default profile. Null: account settings only. */
  profileId?: string | null
  folderId: string | null
  visibility?: Visibility
  password: string
  expiry?: Expiry
  expiryAction?: ExpiryAction
  /** Undefined: the profile's tags. */
  tagIds?: readonly string[]
}

export const NO_CHOICES: UploadChoices = { folderId: null, password: '' }

/** The settings the server will use, and which of them were picked here. */
export type EffectiveUpload = {
  visibility: Visibility
  expiry: Expiry
  expiryAction: ExpiryAction
  tagIds: readonly string[]
  randomizeFileUrls: boolean
  shareStyle: NonNullable<UploadProfileOptions['shareStyle']>
  picked: { visibility: boolean; expiry: boolean; tags: boolean }
}

export const RELATIVE_EXPIRATIONS: readonly {
  value: RelativeExpiration
  label: string
}[] = [
  { value: 'HOUR', label: '1 hour' },
  { value: 'DAY', label: '1 day' },
  { value: 'WEEK', label: '1 week' },
  { value: 'MONTH', label: '1 month' },
]

const afterLabel = (after: RelativeExpiration) =>
  RELATIVE_EXPIRATIONS.find((option) => option.value === after)!.label

function savedExpiry(
  expiration: Required<UploadProfileOptions>['expiration']
): Expiry {
  return expiration === 'DISABLED'
    ? { kind: 'never' }
    : { kind: 'after', after: expiration }
}

/**
 * `saved` is the profile's settings over the account's, as the server merges
 * them. A role that can't share uploads privately whatever is picked.
 */
export function effectiveUpload(
  saved: Required<UploadProfileOptions>,
  choices: UploadChoices,
  canShare: boolean
): EffectiveUpload {
  return {
    visibility: canShare ? (choices.visibility ?? saved.visibility) : 'PRIVATE',
    expiry: choices.expiry ?? savedExpiry(saved.expiration),
    expiryAction: choices.expiryAction ?? saved.expiryAction,
    tagIds: choices.tagIds ?? saved.tagIds,
    randomizeFileUrls: saved.randomizeFileUrls,
    shareStyle: saved.shareStyle,
    picked: {
      visibility: canShare && choices.visibility !== undefined,
      expiry:
        choices.expiry !== undefined || choices.expiryAction !== undefined,
      tags: choices.tagIds !== undefined,
    },
  }
}

/** What the request sends: only what was picked, so the rest stays saved. */
export function uploadOptionsFor(choices: UploadChoices): UploadOptions {
  const { expiry } = choices
  return {
    profileId: choices.profileId,
    folderId: choices.folderId,
    visibility: choices.visibility,
    password: choices.password || undefined,
    ...(expiry?.kind === 'never' && { expiresAt: null }),
    ...(expiry?.kind === 'after' && { expiration: expiry.after }),
    ...(expiry?.kind === 'at' && { expiresAt: expiry.at }),
    expiryAction: choices.expiryAction,
    tagIds: choices.tagIds,
  }
}

/** "Never expires", "Deleted after 1 day", "Private on Nov 30, 3:00 PM". */
export function expiryLabel(expiry: Expiry, action: ExpiryAction) {
  if (expiry.kind === 'never') return 'Never expires'
  const verb = action === 'SET_PRIVATE' ? 'Private' : 'Deleted'
  return expiry.kind === 'after'
    ? `${verb} after ${afterLabel(expiry.after)}`
    : `${verb} ${format(expiry.at, 'MMM d, p')}`
}

/** What a profile does, in short parts, for choosing between them. */
export function profileSummary(
  saved: Required<UploadProfileOptions>,
  canShare: boolean
) {
  const visibility =
    canShare && saved.visibility === 'PUBLIC' ? 'Public' : 'Private'
  const expiry = expiryLabel(
    savedExpiry(saved.expiration),
    saved.expiryAction
  ).toLowerCase()
  const tags = saved.tagIds.length
    ? [`${saved.tagIds.length} ${saved.tagIds.length === 1 ? 'tag' : 'tags'}`]
    : []
  return [
    visibility,
    expiry,
    saved.randomizeFileUrls ? 'random names' : 'original names',
    ...tags,
    `${saved.shareStyle[0].toUpperCase()}${saved.shareStyle.slice(1)} page`,
  ]
}
