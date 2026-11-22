'use client'

import { useEffect } from 'react'

import Link from 'next/link'

import { PermissionGate } from '@/components/roles/permission-gate'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { RefusedRequest } from '@/lib/client/request'
import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
  type UploadProfileView,
} from '@/lib/uploads/schema'

import { useAccountQuery } from '@/hooks/use-account-query'
import { usePermissions } from '@/hooks/use-permissions'

export type ProfilesData = {
  profiles: (UploadProfileView & { effectiveRevision?: string })[]
  defaultProfileId: string | null
  accountOptions: UploadProfileOptions
  effective: Required<UploadProfileOptions>
  canShare: boolean
}

/** The account query that holds the signed-in person's upload profiles. */
export const UPLOAD_PROFILES = 'upload-profiles'

/** The upload profiles; a new `refreshKey` reads them again from scratch. */
export function useUploadProfiles(refreshKey = 0) {
  const { can } = usePermissions()
  const enabled = can('uploadProfiles.manage')
  const profiles = useAccountQuery<ProfilesData>(
    UPLOAD_PROFILES,
    '/api/upload-profiles',
    { key: [refreshKey], retry: false, enabled }
  )
  const failure = enabled ? profiles.error : null
  return {
    data: enabled ? (profiles.data ?? null) : null,
    error: !failure
      ? ''
      : failure instanceof RefusedRequest
        ? 'Could not load upload profiles.'
        : failure.message,
  }
}

/**
 * The upload profile for an archive's output. Archives start private with no
 * profile, so the account's default profile only applies when chosen.
 * (Upload and Paste choose a profile from their options row instead.)
 */
export function ProfilePicker({
  value,
  onChange,
  disabled = false,
  refreshKey = 0,
  onSnapshotChange,
}: {
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
  refreshKey?: number
  onSnapshotChange?: (
    snapshot: {
      id: string
      revision: string
      effectiveRevision: string
    } | null
  ) => void
}) {
  const { user, can } = usePermissions()
  const canManageProfiles = can('uploadProfiles.manage')
  const { data, error } = useUploadProfiles(refreshKey)
  useEffect(() => {
    if (user && !canManageProfiles && value !== null) onChange(null)
  }, [user, canManageProfiles, value, onChange])
  // Summaries and their revision must use the same authority snapshot.
  const canShare = data?.canShare === true
  const selectedId = value
  const profile = data?.profiles.find((entry) => entry.id === selectedId)
  useEffect(() => {
    onSnapshotChange?.(
      profile?.effectiveRevision && typeof data?.canShare === 'boolean'
        ? {
            id: profile.id,
            revision: profile.updatedAt,
            effectiveRevision: profile.effectiveRevision,
          }
        : null
    )
  }, [profile, data?.canShare, onSnapshotChange])
  const effective = !selectedId
    ? { ...UPLOAD_DEFAULTS, visibility: 'PRIVATE' as const }
    : { ...UPLOAD_DEFAULTS, ...data?.accountOptions, ...profile?.options }
  const expiry =
    effective.expiration === 'DISABLED'
      ? 'no expiry'
      : `${{ HOUR: '1 hour', DAY: '1 day', WEEK: '1 week', MONTH: '1 month' }[effective.expiration]}, then ${effective.expiryAction === 'SET_PRIVATE' ? 'private' : 'deleted'}`
  const fixedPrivate =
    'Private · no expiry · original filenames. No upload profile or account defaults are applied.'
  if (!canManageProfiles)
    return (
      <p
        aria-live="polite"
        className="text-pretty text-xs leading-relaxed text-muted-foreground"
      >
        {fixedPrivate}
      </p>
    )
  return (
    <div className="space-y-2">
      {/* One height with or without the link, so a field beside the picker
          lines up with it. */}
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Label htmlFor="upload-profile">Upload profile</Label>
        <PermissionGate permission="uploadProfiles.manage">
          <Link
            href="/dashboard/profile?section=uploads"
            className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Manage profiles
          </Link>
        </PermissionGate>
      </div>
      <Select
        value={value || 'none'}
        onValueChange={(next) => onChange(next === 'none' ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger id="upload-profile">
          <SelectValue placeholder="Private (no profile)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Private (no profile)</SelectItem>
          {data?.profiles.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {data && !canShare && (
        <p className="text-xs text-muted-foreground">
          Your uploads are private because your roles do not allow sharing.
        </p>
      )}
      <p
        aria-live="polite"
        className="text-pretty text-xs leading-relaxed text-muted-foreground"
      >
        {!selectedId
          ? fixedPrivate
          : !profile
            ? error ||
              (data
                ? 'This profile is no longer available. Choose another profile or private output.'
                : 'Loading the selected upload profile…')
            : error ||
              `${!canShare || effective.visibility === 'PRIVATE' ? 'Private' : 'Public'} · ${expiry} · ${effective.randomizeFileUrls ? 'Random filenames' : 'Original filenames'}. ${effective.tagIds?.length || 0} ${effective.tagIds?.length === 1 ? 'tag' : 'tags'} · ${effective.shareStyle} share page.`}
      </p>
      {selectedId &&
        profile &&
        canShare &&
        effective.visibility === 'PUBLIC' && (
          <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-relaxed text-foreground">
            This profile makes the output public. Anyone with its link can
            access content from your selected files, including content that was
            private.
          </p>
        )}
      {error && !selectedId && (
        <p className="text-xs text-muted-foreground">
          {error} You can still continue with private output.
        </p>
      )}
    </div>
  )
}
