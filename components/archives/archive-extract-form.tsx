'use client'

import { useState } from 'react'

import Link from 'next/link'

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Lock,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProfilePicker } from '@/components/upload-profiles/profile-picker'

import { type ArchiveManifest, archiveBasename } from '@/lib/archives/shared'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { folderPath } from '@/lib/folders/navigation'
import { folderNameTaken } from '@/lib/folders/owned'
import { FOLDER_NAME_MAX_LENGTH } from '@/lib/folders/schema'
import { libraryHref } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import { formatBytes } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'

import { ArchiveDestination } from './archive-destination'
import {
  ARCHIVE_REQUEST_FAILED,
  type ArchiveFileRef,
  type ArchiveProfileSnapshot,
  archiveErrorMessage,
  archiveProfileRequest,
} from './archive-utils'

export function ArchiveExtractForm({
  file,
  manifest,
  onBack,
  onClose,
  onBusyChange,
}: {
  file: ArchiveFileRef
  manifest: ArchiveManifest
  onBack: () => void
  onClose: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { user } = usePermissions()
  const lifetime = useRequestLifetime()
  const {
    folders,
    loading,
    error: foldersError,
    reload,
    changed,
  } = useFolders()
  const [folderId, setFolderId] = useState<string | null>(file.folderId ?? null)
  const [name, setName] = useState(() =>
    archiveBasename(file.name).slice(0, 80)
  )
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
    folderId: string
    fileCount: number
    totalBytes: number
  } | null>(null)
  const destinationUnavailable =
    !!folderId &&
    (loading ||
      foldersError ||
      !folders.some((folder) => folder.id === folderId))
  const allowed = allows(user, 'extractArchive')

  async function extract(event: React.FormEvent) {
    event.preventDefault()
    const { signal } = lifetime.current
    if (
      signal.aborted ||
      busy ||
      !profileReady ||
      !allowed ||
      destinationUnavailable
    )
      return
    // The server cannot compare the name with a folder whose name is sealed.
    // This browser reads those names, so it checks them first.
    if (
      folderNameTaken(
        folders.filter((folder) => !folder.locked),
        name.trim(),
        folderId
      )
    ) {
      setError(
        'A folder with that name already exists here. Choose another name.'
      )
      return
    }
    setBusy(true)
    onBusyChange(true)
    setError('')
    try {
      const next = await apiRequest<{
        folderId: string
        fileCount: number
        totalBytes: number
      }>(`/api/files/${encodeURIComponent(file.id)}/archive/extract`, {
        body: {
          folderId,
          name: name.trim(),
          ...archiveProfileRequest(profileId, profileSnapshot),
        },
        signal,
        fallback: ARCHIVE_REQUEST_FAILED,
      })
      if (signal.aborted) return
      void changed()
      setResult(next)
    } catch (cause) {
      if (signal.aborted) return
      setError(archiveErrorMessage(cause))
      if (
        profileId &&
        cause instanceof RefusedRequest &&
        cause.status === 409
      ) {
        setProfileSnapshot(null)
        setProfileRefreshKey((value) => value + 1)
      }
      void reload()
    } finally {
      if (!signal.aborted) {
        setBusy(false)
        onBusyChange(false)
      }
    }
  }

  if (result)
    return (
      <>
        <DialogHeader>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary sm:mx-0">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <DialogTitle>Archive extracted</DialogTitle>
          <DialogDescription>
            {result.fileCount}{' '}
            {result.fileCount === 1 ? 'file is' : 'files are'} ready in your new
            folder. The original archive is unchanged.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl border bg-muted/30 p-4 text-sm">
          {formatBytes(result.totalBytes)} saved
          {profileId
            ? ' using your selected upload profile'
            : ' as private files'}
          , with the archive’s folder structure preserved.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button asChild>
            <Link
              href={libraryHref({ folder: result.folderId })}
              onClick={onClose}
            >
              <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
              Open folder
            </Link>
          </Button>
        </DialogFooter>
      </>
    )

  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle>Extract archive</DialogTitle>
        <DialogDescription className="break-words">
          Extract all {manifest.fileCount}{' '}
          {manifest.fileCount === 1 ? 'file' : 'files'} from{' '}
          <span className="font-medium text-foreground">{file.name}</span> into
          a new account folder.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={extract}
        aria-busy={busy}
      >
        <div
          ref={scrollFadeRef}
          className="scroll-fade scroll-fade-tall -ml-1 min-h-0 space-y-5 overflow-y-auto pl-1 pr-1"
        >
          <ArchiveDestination
            value={folderId}
            onChange={setFolderId}
            disabled={busy}
            allowFolders
          />
          <div className="space-y-2">
            <Label htmlFor="archive-extract-name">New folder name</Label>
            <Input
              id="archive-extract-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={FOLDER_NAME_MAX_LENGTH}
              required
              disabled={busy}
            />
            <p className="break-words text-xs text-muted-foreground">
              {folderId
                ? `Created inside ${folderPath(folders, folderId) || 'the selected folder'}.`
                : 'A new top-level folder will hold the extracted files.'}{' '}
              Existing folders and files will not be overwritten.
            </p>
          </div>
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
          <Alert variant="info" role="status">
            <Lock aria-hidden="true" />
            <AlertDescription>
              Files keep their archive folder structure and use the settings
              shown above. No file password is inherited. Your original archive
              stays in place. This uses up to {formatBytes(manifest.totalBytes)}{' '}
              of account storage.
            </AlertDescription>
          </Alert>
        </div>
        {/* Outside the scrolling fields, so they show wherever the fields
            are scrolled to. */}
        {(error || busy) && (
          <div className="mr-1 mt-4 shrink-0 space-y-3">
            {error && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                Extracting files… This can take up to two minutes. Keep this
                dialog open.
              </p>
            )}
          </div>
        )}
        {/* A margin, not padding, so the divider ends with the fields above
            it (the body keeps a 4px gutter on the right). */}
        <DialogFooter className="mr-1 mt-4 shrink-0 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onBack}
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to archive
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              !allowed ||
              !profileReady ||
              destinationUnavailable ||
              !name.trim() ||
              !manifest.entries.length
            }
          >
            {busy && (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            Extract files
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
