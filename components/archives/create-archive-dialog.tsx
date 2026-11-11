'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import Link from 'next/link'

import type { FileType } from '@/types/components/file'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Lock,
} from 'lucide-react'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ProfilePicker,
  useUploadProfiles,
} from '@/components/upload-profiles/profile-picker'

import { createInWorker } from '@/lib/archives/client/archive-worker'
import { canWriteTarGz } from '@/lib/archives/client/archive-writer'
import type { JobProgress, JobSource } from '@/lib/archives/client/jobs'
import { ARCHIVE_LIMITS, type ArchiveOutputFormat } from '@/lib/archives/shared'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import {
  openedFile,
  openedFileState,
  openedFiles,
} from '@/lib/e2ee/client/opened-files'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import { safeFileName } from '@/lib/files/safe-render'
import { fileUrls } from '@/lib/files/urls'
import { requestMaintenance } from '@/lib/library/browser-maintenance'
import { UNFILED, libraryHref } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import { formatBytes, formatFileSize } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'
import { mbToBytes } from '@/lib/utils/size'

import { openOwnedFile } from '@/hooks/use-encrypted-file'
import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'

import { ArchiveDestination } from './archive-destination'
import {
  ARCHIVE_FORM_DIALOG_CLASS,
  ARCHIVE_REQUEST_FAILED,
  type ArchiveFileRef,
  type ArchiveProfileSnapshot,
  archiveErrorMessage,
  archiveOutputName,
  archiveProfileRequest,
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
  const { user } = usePermissions()
  const canUseFolders = allows(user, 'fileIntoFolder')
  const lifetime = useRequestLifetime()
  const {
    folders,
    loading,
    error: foldersError,
    reload,
    changed,
  } = useFolders()
  const [folderId, setFolderId] = useState<string | null>(() =>
    canUseFolders ? initialFolderId : null
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
  // A selection with an encrypted file is archived in this browser: the
  // server cannot read such a file, and the new archive is encrypted too
  // (docs/e2ee-spec.md, section 12.3). So is a selection of plain files
  // where the administrator forbids plain uploads: the server would make a
  // plain archive and refuse to store it (section 11.1).
  const plainForbidden =
    useUploadProfiles().data?.plainUploadsForbidden === true
  const encryptedSources = files.some((file) => file.encrypted)
  const inBrowser = encryptedSources || plainForbidden
  const keys = useAccountKeyState()
  const accountKeys = keys.status === 'unlocked' ? keys.keys : null
  const snapshot = useSyncExternalStore(
    openedFiles.subscribe,
    openedFiles.version,
    openedFiles.version
  )
  const [progress, setProgress] = useState<JobProgress | null>(null)
  // The decrypted name of each encrypted file, once its stanza is open.
  const names = new Map(
    files.map((file) => [
      file.id,
      file.encrypted
        ? (() => {
            const { opened } = openedFileState(file.id, snapshot)
            return opened ? safeFileName(opened.name) : null
          })()
        : file.name,
    ])
  )
  const unopened = files.filter(
    (file) => file.encrypted && names.get(file.id) === null
  )
  const unopenedIds = unopened.map((file) => file.id).join(',')
  useEffect(() => {
    if (!accountKeys) return
    // Files that no card on screen has opened yet.
    for (const file of unopened)
      if (file.encryption)
        void openOwnedFile(file.id, file.encryption, accountKeys)
    // The list is the same while its IDs are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unopenedIds, accountKeys])
  const destinationUnavailable =
    !!folderId &&
    (!canUseFolders ||
      loading ||
      foldersError ||
      !folders.some((folder) => folder.id === folderId))
  const allowed = allows(user, 'createArchive')

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
      let next: { file: ArchiveFileRef; totalBytes: number }
      if (inBrowser) {
        if (!accountKeys)
          throw new Error('Unlock your encryption keys, then try again.')
        setProgress(null)
        const sources: JobSource[] = files.map((file) => {
          const url = fileUrls(file).content
          const size = Math.round(mbToBytes(file.size))
          if (!file.encrypted)
            return { encrypted: false, url, name: file.name, size }
          const opened = openedFile(file.id)
          if (!opened || !file.encryption)
            throw new Error(
              'One of the selected files could not be opened with your keys. Close this dialog and try again.'
            )
          return {
            encrypted: true,
            url,
            fileKey: opened.fileKey,
            header: base64urlDecode(file.encryption.header),
            storedLength: size,
            name: opened.name,
            type: opened.type,
          }
        })
        const created = await createInWorker(
          {
            sources,
            output: { name: archiveOutputName(name, format), format },
            // Private and without expiration unless a profile says otherwise.
            target: profileId
              ? { folderId, profileId }
              : {
                  folderId,
                  profileId: null,
                  visibility: 'PRIVATE',
                  expiresAt: null,
                },
            accountPublicKey: accountKeys.accountPublicKey,
          },
          { signal, onProgress: setProgress }
        )
        // The new file waits for its tag rules and, where a profile made it
        // public in a folder, for its folder stanza (section 9.7).
        requestMaintenance('folders', 'index', 'pending')
        next = {
          file: {
            id: created.id,
            name: created.name,
            urlPath: created.urlPath,
            folderId,
            encrypted: true,
            encryption: { ...created.records, passwordStanza: null },
          },
          totalBytes: created.totalBytes,
        }
      } else
        next = await apiRequest<{
          file: ArchiveFileRef
          totalBytes: number
        }>('/api/files/archive', {
          body: {
            fileIds: files.map((file) => file.id),
            name: archiveOutputName(name, format),
            format,
            folderId,
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
                <span className="font-medium text-foreground">
                  {result.file.name}
                </span>{' '}
                is saved in your account
                {profileId
                  ? ' using your selected upload profile'
                  : ' as a private file'}
                {inBrowser ? ', encrypted in this browser' : ''}. Your original
                files are unchanged.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" asChild>
                <Link
                  href={libraryHref({
                    folder: result.file.folderId || UNFILED,
                  })}
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
              <div
                ref={scrollFadeRef}
                className="scroll-fade scroll-fade-tall -ml-1 min-h-0 space-y-5 overflow-y-auto pl-1 pr-1"
              >
                <details className="rounded-xl border bg-muted/30 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Selected files ({files.length})
                  </summary>
                  <ul
                    ref={scrollFadeRef}
                    className="scroll-fade mt-3 max-h-36 space-y-2 overflow-y-auto overscroll-contain"
                    aria-label="Selected archive files"
                  >
                    {files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <span className="min-w-0 break-words">
                          {names.get(file.id) ?? 'Encrypted file'}
                        </span>
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
                        <SelectItem
                          value="tar.gz"
                          disabled={inBrowser && !canWriteTarGz()}
                        >
                          TAR.GZ
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-pretty text-xs text-muted-foreground sm:col-span-2">
                    ZIP works with most devices. TAR.GZ is useful for Unix tools
                    and project bundles.
                  </p>
                </div>
                <ArchiveDestination
                  value={folderId}
                  onChange={setFolderId}
                  disabled={busy}
                  allowFolders={canUseFolders}
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
                <Alert variant="info" role="status">
                  <Lock aria-hidden="true" />
                  <AlertDescription>
                    {encryptedSources
                      ? 'This browser decrypts the selected files, builds the archive and uploads it encrypted, so large files take time and bandwidth. The archive'
                      : inBrowser
                        ? 'This server accepts encrypted uploads only, so this browser builds the archive from the selected files and uploads it encrypted. Large files take time and bandwidth. The archive'
                        : 'Your archive'}{' '}
                    uses the settings shown above. Original files stay
                    unchanged. No file password is inherited.
                  </AlertDescription>
                </Alert>
              </div>
              {/* Outside the scrolling fields, so they show wherever the
                  fields are scrolled to. */}
              {(overLimit || error || busy) && (
                <div className="mr-1 mt-4 shrink-0 space-y-3">
                  {overLimit && (
                    <p role="alert" className="text-sm text-destructive">
                      Choose up to {ARCHIVE_LIMITS.selectedFiles} files, no
                      larger than 256 MiB each and 512 MiB in total.
                    </p>
                  )}
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle aria-hidden="true" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  {busy && !inBrowser && (
                    <p role="status" className="text-sm text-muted-foreground">
                      Creating archive… This can take up to two minutes. Keep
                      this dialog open.
                    </p>
                  )}
                  {busy && inBrowser && (
                    <div role="status" className="space-y-2">
                      <Progress
                        value={
                          progress?.bytesTotal
                            ? (progress.bytesDone / progress.bytesTotal) * 100
                            : 0
                        }
                        aria-label="Archive creation progress"
                        className="h-1.5"
                      />
                      <p className="break-words text-sm text-muted-foreground">
                        {progress && progress.bytesDone < progress.bytesTotal
                          ? `Adding file ${Math.min(progress.filesDone + 1, progress.filesTotal)} of ${progress.filesTotal}. Keep this dialog open.`
                          : progress
                            ? 'Encrypting and uploading the archive… Keep this dialog open.'
                            : 'Reading the selected files… Keep this dialog open.'}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* A margin, not padding, so the divider ends with the fields
                  above it (the body keeps a 4px gutter on the right). */}
              <DialogFooter className="mr-1 mt-4 shrink-0 border-t pt-4">
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
                    (inBrowser && (!accountKeys || unopened.length > 0)) ||
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
