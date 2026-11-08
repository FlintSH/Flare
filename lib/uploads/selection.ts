import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
  type UploadProfileView,
} from './schema'
import { type UploadSummaryOverrides, uploadSettingsSummary } from './summary'

/** Narrow display input from the existing authorized response. Archive revisions
 * and its authority snapshot stay in ProfilePicker, outside this ordinary model. */
export type UploadSelectionData = {
  profiles: Pick<UploadProfileView, 'id' | 'name' | 'options'>[]
  defaultProfileId: string | null
  accountOptions: UploadProfileOptions
  effective: Required<UploadProfileOptions>
}

export type OrdinaryUploadSelection = ReturnType<typeof ordinaryUploadSelection>

/** Resolve display state only. Never mutate the selected request value or options. */
export function ordinaryUploadSelection({
  value,
  data,
  error,
  accountKnown,
  canManageProfiles,
  canShare,
  overrides,
}: {
  value?: string | null
  data: UploadSelectionData | null
  error: string
  accountKnown: boolean
  canManageProfiles: boolean
  canShare: boolean
  overrides?: UploadSummaryOverrides
}) {
  const selectedValue =
    value === undefined ? 'default' : value === null ? 'none' : value
  // Do not retain a previous account's profile names when the session is unknown
  // or the current role cannot read them, even if a caller still holds data.
  const available = accountKnown && canManageProfiles ? data : null
  const base = {
    value,
    selectedValue,
    canManageProfiles: accountKnown && canManageProfiles,
    profiles: available?.profiles ?? [],
    defaultProfileName: available?.profiles.find(
      (p) => p.id === available?.defaultProfileId
    )?.name,
  }
  const unknown = (
    status: 'loading' | 'automatic' | 'error' | 'unavailable',
    summary: string
  ) => ({
    ...base,
    status,
    summary,
    effective: null,
  })
  if (!accountKnown) return unknown('loading', 'Loading saved upload settings…')
  if (!canManageProfiles)
    return unknown(
      'automatic',
      [
        ...(!canShare ? ['Private.'] : []),
        'Saved defaults apply automatically; full settings are unavailable for this role.',
      ].join(' ')
    )
  if (error)
    return unknown(
      'error',
      `${error} The effective settings could not be previewed.`
    )
  if (!data) return unknown('loading', 'Loading saved upload settings…')
  const profile =
    typeof value === 'string'
      ? data.profiles.find((p) => p.id === value)
      : undefined
  if (typeof value === 'string' && !profile)
    return unknown(
      'unavailable',
      'This upload profile is no longer available. Choose another profile or Account settings only.'
    )
  const effective =
    value === undefined
      ? data.effective
      : { ...UPLOAD_DEFAULTS, ...data.accountOptions, ...profile?.options }
  return {
    ...base,
    status: 'ready' as const,
    effective,
    summary: uploadSettingsSummary(effective, canShare, overrides),
  }
}
