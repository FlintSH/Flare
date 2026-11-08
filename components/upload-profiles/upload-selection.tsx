'use client'

import { type ReactNode, useEffect } from 'react'

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

import { allows } from '@/lib/permissions/actions'
import {
  type OrdinaryUploadSelection,
  ordinaryUploadSelection,
} from '@/lib/uploads/selection'
import type { UploadSummaryOverrides } from '@/lib/uploads/summary'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'

import { useUploadProfiles } from './profile-picker'

/** One existing account/session-scoped profile read for both ordinary form views. */
export function useUploadSelection({
  value,
  onChange,
  overrides,
}: {
  value?: string | null
  onChange: (value: string | null | undefined) => void
  overrides?: UploadSummaryOverrides
}) {
  const { user, can } = usePermissions()
  const canManageProfiles = can('uploadProfiles.manage')
  const { data, error } = useUploadProfiles()
  useEffect(() => {
    if (user && !canManageProfiles && value !== undefined) onChange(undefined)
  }, [user, canManageProfiles, value, onChange])
  return ordinaryUploadSelection({
    value,
    data,
    error,
    accountKnown: Boolean(user),
    canManageProfiles,
    canShare: allows(user, 'shareFiles'),
    overrides,
  })
}

/** Mount the ordinary query only while a creation form is actually present. */
export function UploadSelection({
  children,
  ...options
}: Parameters<typeof useUploadSelection>[0] & {
  children: (selection: OrdinaryUploadSelection) => ReactNode
}) {
  const selection = useUploadSelection(options)
  return children(selection)
}

/** Pure ordinary selector: it never makes its own request or announces a second summary. */
export function UploadProfileSelect({
  selection,
  onChange,
  disabled = false,
}: {
  selection: OrdinaryUploadSelection
  onChange: (value: string | null | undefined) => void
  disabled?: boolean
}) {
  if (!selection.canManageProfiles) return null
  return (
    <div className="space-y-2">
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
        value={selection.selectedValue}
        onValueChange={(next) =>
          onChange(
            next === 'default' ? undefined : next === 'none' ? null : next
          )
        }
        disabled={disabled}
      >
        <SelectTrigger id="upload-profile">
          <SelectValue placeholder="Account default">
            {selection.status === 'unavailable'
              ? 'Unavailable profile'
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            Account default
            {selection.defaultProfileName
              ? ` (${selection.defaultProfileName})`
              : ''}
          </SelectItem>
          <SelectItem value="none">Account settings only</SelectItem>
          {selection.profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** A single complete, non-clamped description next to the final action. */
export function UploadActionSummary({
  id,
  selection,
  className,
}: {
  id: string
  selection: OrdinaryUploadSelection
  className?: string
}) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn(
        'text-pretty text-sm leading-relaxed text-foreground',
        className
      )}
    >
      {selection.summary}
    </p>
  )
}
