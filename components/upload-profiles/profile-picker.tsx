'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

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

export type ProfilesData = {
  profiles: UploadProfileView[]
  defaultProfileId: string | null
  accountOptions: UploadProfileOptions
  effective: Required<UploadProfileOptions>
}

export function useUploadProfiles() {
  const [data, setData] = useState<ProfilesData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/upload-profiles')
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
  }, [])
  return { data, error }
}

export function ProfilePicker({
  value,
  onChange,
  disabled = false,
}: {
  value?: string | null
  onChange: (value: string | null | undefined) => void
  disabled?: boolean
}) {
  const { data, error } = useUploadProfiles()
  const selectedId = value === undefined ? data?.defaultProfileId : value
  const profile = data?.profiles.find((entry) => entry.id === selectedId)
  const effective =
    value === undefined
      ? data?.effective
      : { ...UPLOAD_DEFAULTS, ...data?.accountOptions, ...profile?.options }
  const expiry =
    effective?.expiration === 'DISABLED'
      ? 'no expiry'
      : { HOUR: '1 hour', DAY: '1 day', WEEK: '1 week', MONTH: '1 month' }[
          effective?.expiration as 'HOUR'
        ]
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="upload-profile">Upload profile</Label>
        <Link
          href="/dashboard/profile?section=uploads"
          className="text-sm underline underline-offset-4 text-muted-foreground"
        >
          Manage profiles
        </Link>
      </div>
      <Select
        value={
          value === undefined ? 'default' : value === null ? 'none' : value
        }
        onValueChange={(next) =>
          onChange(
            next === 'default' ? undefined : next === 'none' ? null : next
          )
        }
        disabled={disabled}
      >
        <SelectTrigger id="upload-profile">
          <SelectValue placeholder="Account default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            Account default
            {data?.defaultProfileId && profile
              ? ` (${data.profiles.find((p) => p.id === data.defaultProfileId)?.name})`
              : ''}
          </SelectItem>
          <SelectItem value="none">Account settings only</SelectItem>
          {data?.profiles.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {error ||
          (effective
            ? `${effective.visibility === 'PRIVATE' ? 'Private' : 'Public'} · ${expiry} · ${effective.randomizeFileUrls ? 'Random filenames' : 'Original filenames'}. Options below override this upload only.`
            : 'Your saved default is applied by the server.')}
      </p>
    </div>
  )
}
