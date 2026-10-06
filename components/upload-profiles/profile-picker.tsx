'use client'

import { useEffect, useState } from 'react'

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

import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
  type UploadProfileView,
} from '@/lib/uploads/schema'

import { usePermissions } from '@/hooks/use-permissions'

export type ProfilesData = {
  profiles: (UploadProfileView & { effectiveRevision?: string })[]
  defaultProfileId: string | null
  accountOptions: UploadProfileOptions
  effective: Required<UploadProfileOptions>
  canShare: boolean
}

export function useUploadProfiles(refreshKey = 0) {
  const [data, setData] = useState<ProfilesData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    const load = () =>
      fetch('/api/upload-profiles', { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) throw new Error('Could not load upload profiles.')
          const result = await res.json()
          if (alive) {
            setData(result.data)
            setError('')
          }
        })
        .catch((failure) => {
          if (alive) setError(failure.message)
        })
    void load()
    window.addEventListener('flare:upload-profiles-changed', load)
    return () => {
      alive = false
      window.removeEventListener('flare:upload-profiles-changed', load)
    }
  }, [refreshKey])
  return { data, error }
}

export function ProfilePicker({
  value,
  onChange,
  disabled = false,
  mode = 'upload',
  refreshKey = 0,
  onSnapshotChange,
}: {
  value?: string | null
  onChange: (value: string | null | undefined) => void
  disabled?: boolean
  mode?: 'upload' | 'archive'
  refreshKey?: number
  onSnapshotChange?: (
    snapshot: {
      id: string
      revision: string
      effectiveRevision: string
    } | null
  ) => void
}) {
  const { can } = usePermissions()
  const { data, error } = useUploadProfiles(refreshKey)
  const archiveMode = mode === 'archive'
  // Archive summaries and their revision must use the same authority snapshot.
  const canShare = archiveMode ? data?.canShare === true : can('files.share')
  const selectedId = archiveMode
    ? (value ?? null)
    : value === undefined
      ? data?.defaultProfileId
      : value
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
  const effective =
    archiveMode && !selectedId
      ? { ...UPLOAD_DEFAULTS, visibility: 'PRIVATE' as const }
      : value === undefined
        ? data?.effective
        : { ...UPLOAD_DEFAULTS, ...data?.accountOptions, ...profile?.options }
  const expiry =
    effective?.expiration === 'DISABLED'
      ? 'no expiry'
      : { HOUR: '1 hour', DAY: '1 day', WEEK: '1 week', MONTH: '1 month' }[
          effective?.expiration as 'HOUR'
        ]
  const archiveExpiry =
    effective?.expiration === 'DISABLED'
      ? expiry
      : `${expiry}, then ${effective?.expiryAction === 'SET_PRIVATE' ? 'private' : 'deleted'}`
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="upload-profile">Upload profile</Label>
        <PermissionGate permission="uploadProfiles.manage">
          <Link
            href="/dashboard/profile?section=uploads"
            className="text-sm underline underline-offset-4 text-muted-foreground"
          >
            Manage profiles
          </Link>
        </PermissionGate>
      </div>
      <Select
        value={
          archiveMode
            ? value || 'none'
            : value === undefined
              ? 'default'
              : value === null
                ? 'none'
                : value
        }
        onValueChange={(next) =>
          onChange(
            next === 'default' ? undefined : next === 'none' ? null : next
          )
        }
        disabled={disabled}
      >
        <SelectTrigger id="upload-profile">
          <SelectValue
            placeholder={
              archiveMode ? 'Private (no profile)' : 'Account default'
            }
          />
        </SelectTrigger>
        <SelectContent>
          {!archiveMode && (
            <SelectItem value="default">
              Account default
              {data?.defaultProfileId && profile
                ? ` (${data.profiles.find((p) => p.id === data.defaultProfileId)?.name})`
                : ''}
            </SelectItem>
          )}
          <SelectItem value="none">
            {archiveMode ? 'Private (no profile)' : 'Account settings only'}
          </SelectItem>
          {data?.profiles.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(archiveMode ? data && !canShare : !canShare) && (
        <p className="text-xs text-muted-foreground">
          Your uploads are private because your roles do not allow sharing.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {archiveMode && !selectedId
          ? 'Private · no expiry · original filenames. No upload profile or account defaults are applied.'
          : archiveMode && selectedId && !profile
            ? error ||
              (data
                ? 'This profile is no longer available. Choose another profile or private output.'
                : 'Loading the selected upload profile…')
            : error ||
              (effective
                ? `${!canShare || effective.visibility === 'PRIVATE' ? 'Private' : 'Public'} · ${archiveMode ? archiveExpiry : expiry} · ${effective.randomizeFileUrls ? 'Random filenames' : 'Original filenames'}.${archiveMode ? ` ${effective.tagIds?.length || 0} ${effective.tagIds?.length === 1 ? 'tag' : 'tags'} · ${effective.shareStyle} share page.` : ' Options below override this upload only.'}`
                : 'Your saved default is applied by the server.')}
      </p>
      {archiveMode &&
        selectedId &&
        profile &&
        canShare &&
        effective?.visibility === 'PUBLIC' && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-foreground">
            This profile makes the output public. Anyone with its link can
            access content from your selected files, including content that was
            private.
          </p>
        )}
      {archiveMode && error && !selectedId && (
        <p className="text-xs text-muted-foreground">
          {error} You can still continue with private output.
        </p>
      )}
    </div>
  )
}
