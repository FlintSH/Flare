'use client'

import { useState } from 'react'

import Link from 'next/link'

import type { FileType } from '@/types/components/file'
import { Archive, CheckCircle2, FolderOpen, Loader2, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProfilePicker } from '@/components/upload-profiles/profile-picker'

import { ARCHIVE_LIMITS, type ArchiveOutputFormat } from '@/lib/archives/shared'
import { formatBytes, formatFileSize } from '@/lib/utils'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'

import { ArchiveDestination } from './archive-destination'
import {
  ARCHIVE_FORM_DIALOG_CLASS,
  type ArchiveFileRef,
  type ArchiveProfileSnapshot,
  ArchiveRequestError,
  archiveErrorMessage,
  archiveOutputName,
  archiveProfileRequest,
  archiveRequest,
  archiveSelectionSize,
} from './archive-utils'

export function CreateArchiveDialog({
  files,
  initialFolderId,
  onClose,
  onOpenArchive,
}: {
  files: FileType[]
  initialFolderId: string | null
  onClose: () => void
  onOpenArchive: (file: ArchiveFileRef) => void
}) {
  const { can } = usePermissions()
  const lifetime = useRequestLifetime()
  const {
    folders,
    loading,
    error: foldersError,
    reload,
    changed,
  } = useFolders()
  const [folderId, setFolderId] = useState<string | null>(() =>
    can('folders.manage') ? initialFolderId : null
  )
  const [format, setFormat] = useState<ArchiveOutputFormat>('zip')
  const [name, setName] = useState('Archive.zip')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profileSnapshot, setProfileSnapshot] =
    useState<ArchiveProfileSnapshot | null>(null)
  const [profileRefreshKey, setProfileRefreshKey] = useState(0)
  const profileReady =
    !profileId ||
    (profileSnapshot?.id === profileId && !!profileSnapshot.effectiveRevision)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    file: ArchiveFileRef
    totalBytes: number
  } | null>(null)
  const { totalBytes, overLimit } = archiveSelectionSize(files)
  const destinationUnavailable =
    !!folderId &&
    (!can('folders.manage') ||
      loading ||
      foldersError ||
      !folders.some((folder) => folder.id === folderId))
  const allowed = can('files.read') && can('files.upload')

  async function create(event: React.FormEvent) {
    event.preventDefault()
    const { signal } = lifetime.current
    if (
      signal.aborted ||
      busy ||
      !profileReady ||
      !allowed ||
      overLimit ||
      destinationUnavailable
    )
      return
    setBusy(true)
    setError('')
    try {
      const next = await archiveRequest<{
        file: ArchiveFileRef
        totalBytes: number
      }>(
        '/api/files/archive',
        {
          fileIds: files.map((file) => file.id),
          name: archiveOutputName(name, format),
          format,
          folderId,
          ...archiveProfileRequest(profileId, profileSnapshot),
        },
        signal
      )
      if (signal.aborted) return
      changed()
      setResult(next)
    } catch (cause) {
      if (signal.aborted) return
      setError(archiveErrorMessage(cause))
      if (
        profileId &&
        cause instanceof ArchiveRequestError &&
        cause.status === 409
      ) {
        setProfileSnapshot(null)
        setProfileRefreshKey((value) => value + 1)
      }
      void reload()
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className={result ? undefined : ARCHIVE_FORM_DIALOG_CLASS}
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        {result ? (
          <>
            <DialogHeader>
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary sm:mx-0">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </span>
              <DialogTitle>Archive created</DialogTitle>
              <DialogDescription className="break-words">
                {result.file.name} is saved in your account
                {profileId
                  ? ' using your selected upload profile'
                  : ' as a private file'}
                . Your original files are unchanged.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" asChild>
                <Link
                  href={`/dashboard?folder=${encodeURIComponent(result.file.folderId || 'unfiled')}`}
                  onClick={onClose}
                >
                  <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
                  Open folder
                </Link>
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenArchive(result.file)
                }}
              >
                <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                Open archive
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="shrink-0">
              <DialogTitle>Create archive</DialogTitle>
              <DialogDescription>
                Save {files.length} selected{' '}
                {files.length === 1 ? 'file' : 'files'} (
                {formatBytes(totalBytes)}) together in your account.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={create}
              className="flex min-h-0 flex-1 flex-col"
              aria-busy={busy}
            >
              <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
                <details className="rounded-xl border bg-muted/20 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Selected files ({files.length})
                  </summary>
                  <ul
                    className="mt-3 max-h-36 space-y-2 overflow-y-auto"
                    aria-label="Selected archive files"
                  >
                    {files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <span className="min-w-0 break-words">{file.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <div className="space-y-2">
                    <Label htmlFor="archive-create-name">Archive name</Label>
                    <Input
                      id="archive-create-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={160}
                      required
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="archive-create-format">Format</Label>
                    <Select
                      value={format}
                      onValueChange={(value: ArchiveOutputFormat) => {
                        setFormat(value)
                        setName((current) => archiveOutputName(current, value))
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger id="archive-create-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zip">ZIP</SelectItem>
                        <SelectItem value="tar.gz">TAR.GZ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    ZIP works with most devices. TAR.GZ is useful for Unix tools
                    and project bundles.
                  </p>
                </div>
                <ArchiveDestination
                  value={folderId}
                  onChange={setFolderId}
                  disabled={busy}
                  allowFolders={can('folders.manage')}
                />
                <ProfilePicker
                  mode="archive"
                  value={profileId}
                  onChange={(value) => {
                    setProfileId(value ?? null)
                    setProfileSnapshot(null)
                  }}
                  refreshKey={profileRefreshKey}
                  onSnapshotChange={setProfileSnapshot}
                  disabled={busy}
                />
                <div className="flex gap-3 rounded-xl border bg-muted/20 p-4 text-sm leading-relaxed">
                  <Lock
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p>
                    Your archive uses the settings shown above. Original files
                    stay unchanged. No file password is inherited.
                  </p>
                </div>
                {overLimit && (
                  <p role="alert" className="text-sm text-destructive">
                    Choose up to {ARCHIVE_LIMITS.selectedFiles} files, no larger
                    than 256 MiB each and 512 MiB in total.
                  </p>
                )}
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
                {busy && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Creating archive… This can take up to two minutes. Keep this
                    dialog open.
                  </p>
                )}
              </div>
              <DialogFooter className="shrink-0 border-t pt-4 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !allowed ||
                    !profileReady ||
                    !name.trim() ||
                    !files.length ||
                    overLimit ||
                    destinationUnavailable
                  }
                >
                  {busy && (
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Create archive
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
