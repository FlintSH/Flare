'use client'

import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { ExpiryAction } from '@/types/events'
import { $Enums } from '@prisma/client'
import { format } from 'date-fns'
import {
  AlertCircle,
  CalendarClock,
  Check,
  Copy,
  File,
  Folder,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useDropzone } from 'react-dropzone'

import {
  FilePasswordHint,
  filePasswordFieldProps,
} from '@/components/file/file-password-hint'
import { CreationOptions } from '@/components/shared/creation-options'
import { ExpiryModal } from '@/components/shared/expiry-modal'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { ProfilePicker } from '@/components/upload-profiles/profile-picker'

import { filePasswordHint } from '@/lib/files/password-policy'
import { folderPath } from '@/lib/folders/navigation'
import { UNFILED, folderDestination, libraryHref } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import type { UploadResponse } from '@/lib/uploads/client'
import { uploadActivity } from '@/lib/uploads/queue'
import { cn, formatBytes } from '@/lib/utils'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { copyUploadLinks, useUploadQueue } from '@/hooks/use-upload-queue'

// The form's text actions share one look, matching the upload profile
// picker's "Manage profiles" link.
const textActionClassName =
  'min-h-8 rounded-sm text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50'
const uploadingSnapshot = () => uploadActivity.get().uploading

interface UploadFormProps {
  maxSize: number
  formattedMaxSize: string
  user: {
    defaultFileExpiration: $Enums.FileExpiration | null
    defaultFileExpirationAction: $Enums.ExpiryAction | null
  }
}

export function UploadForm({
  maxSize,
  formattedMaxSize,
  user,
}: UploadFormProps) {
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)
  const [completed, setCompleted] = useState<UploadResponse[]>([])
  const [uploadError, setUploadError] = useState('')
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const [submitBarElement, setSubmitBarElement] =
    useState<HTMLDivElement | null>(null)
  const [submitBarHeight, setSubmitBarHeight] = useState(0)
  const pickerId = useId()
  const pickerTitleId = `${pickerId}-title`
  const pickerHintId = `${pickerId}-hint`
  const queueListId = `${pickerId}-queue`
  const waitingHintId = `${pickerId}-waiting`
  const anyUploadInProgress = useSyncExternalStore(
    uploadActivity.subscribe,
    uploadingSnapshot,
    uploadingSnapshot
  )
  const { user: sessionUser } = usePermissions()
  const canShare = allows(sessionUser, 'shareFiles')
  // Until the session loads, keep a requested folder. The server refuses
  // folder destinations to roles without folder management.
  const canChooseFolder = !sessionUser || allows(sessionUser, 'fileIntoFolder')
  const searchParams = useSearchParams()
  const initialFolder = canChooseFolder
    ? folderDestination(searchParams.get('folder'))
    : null
  const { folders, loading: foldersLoading, error: foldersError } = useFolders()
  const {
    files,
    uploading: isUploading,
    add,
    remove,
    clear,
    upload,
  } = useUploadQueue()
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>()
  const [password, setPassword] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date | null>()
  const [expiryAction, setExpiryAction] = useState<'DELETE' | 'SET_PRIVATE'>()
  const [profileId, setProfileId] = useState<string | null>()
  const [folderId, setFolderId] = useState(initialFolder)
  useEffect(() => {
    setFolderId(initialFolder)
  }, [initialFolder])
  const showFolders = canChooseFolder && (folders.length > 0 || !!folderId)
  const selectedFolder = folders.find((folder) => folder.id === folderId)
  const unavailableFolder = !!folderId && !selectedFolder && !foldersLoading

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (files.length === 0) setQueueExpanded(false)
      const tooLarge = add(acceptedFiles, maxSize)
      setUploadError(
        tooLarge.length
          ? `${tooLarge.length} ${tooLarge.length === 1 ? 'file could' : 'files could'} not be added. Each file must be ${formattedMaxSize} or smaller.`
          : ''
      )
    },
    disabled: isUploading,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  })
  const totalSize = files.reduce((total, { file }) => total + file.size, 0)
  const floatingSubmit =
    files.length > 0 && !isUploading && !anyUploadInProgress
  const shownFiles = queueExpanded || isUploading ? files : files.slice(0, 2)
  const waitingForUpload =
    files.length > 0 && anyUploadInProgress && !isUploading

  useLayoutEffect(() => {
    if (!submitBarElement || !floatingSubmit) {
      setSubmitBarHeight(0)
      return
    }
    const measure = () =>
      setSubmitBarHeight(
        Math.ceil(submitBarElement.getBoundingClientRect().height)
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(submitBarElement)
    return () => observer.disconnect()
  }, [submitBarElement, floatingSubmit])

  const uploadQueued = async () => {
    // The shared activity can change after this button was rendered.
    if (uploadActivity.get().uploading) return
    const batch = await upload({
      profileId,
      folderId,
      visibility,
      password,
      expiresAt,
      expiryAction,
    })
    if (!batch) return
    if (!batch.failure) setQueueExpanded(false)
    if (batch.uploaded.length) {
      setCompleted((previous) => [...batch.uploaded, ...previous])
      setUploadError('')
    }
    if (batch.failure) setUploadError(batch.failure.message)
  }

  const copyLinks = async (value: string) => {
    if (await copyUploadLinks(value)) setCopiedLink(value)
  }

  const uploadButton = (
    <Button
      type="button"
      data-upload-primary=""
      aria-describedby={waitingForUpload ? waitingHintId : undefined}
      className="min-h-[44px] w-full whitespace-normal"
      onClick={() => {
        setUploadError('')
        void uploadQueued()
      }}
      disabled={
        files.length === 0 ||
        isUploading ||
        anyUploadInProgress ||
        unavailableFolder ||
        (!!folderId && foldersLoading) ||
        Boolean(password && filePasswordHint(password))
      }
    >
      {isUploading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Upload className="hidden h-4 w-4 sm:block" aria-hidden="true" />
      )}
      {isUploading
        ? 'Uploading…'
        : files.length
          ? `Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}`
          : 'Upload files'}
    </Button>
  )

  return (
    <div className="space-y-6">
      <div
        {...getRootProps({
          role: 'region',
          'aria-label': 'File selection',
          'aria-describedby': pickerHintId,
          'aria-disabled': isUploading,
        })}
        className={cn(
          // The page's main input: a dashed 3:1 control outline, like the
          // fields below it.
          'relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-control bg-muted/20 px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary/5',
          isDragActive && 'border-primary bg-primary/5',
          isUploading && 'pointer-events-none opacity-60'
        )}
      >
        <input
          {...getInputProps({
            id: `${pickerId}-input`,
            'aria-label': 'Files to upload',
            'aria-describedby': pickerHintId,
            disabled: isUploading,
          })}
        />
        {/* Keep the whole selection area clickable with a native button.
            The input and descriptive hints remain its siblings. */}
        <button
          type="button"
          data-flare-control=""
          aria-labelledby={pickerTitleId}
          aria-describedby={pickerHintId}
          disabled={isUploading}
          onClick={open}
          className="absolute inset-0 z-10 min-h-11 w-full cursor-pointer rounded-xl border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <Upload
          className="mb-3 h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p id={pickerTitleId} className="text-balance text-base font-medium">
          {isDragActive ? (
            'Drop your files here'
          ) : (
            <>
              <span>Choose files</span>
              <span className="sr-only"> to upload</span>
            </>
          )}
        </p>
        <p id={pickerHintId} className="mt-1 text-sm text-muted-foreground">
          {!isDragActive && (
            <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline">
              Or drag and drop files here.{' '}
            </span>
          )}
          Maximum file size: {formattedMaxSize}
        </p>
      </div>

      {uploadError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      )}

      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              Selected files{' '}
              <span className="text-sm font-normal text-muted-foreground">
                ({files.length} · {formatBytes(totalSize)})
              </span>
            </h2>
            <button
              type="button"
              data-flare-control="button"
              className={textActionClassName}
              onClick={() => {
                clear()
                setQueueExpanded(false)
              }}
              disabled={isUploading}
            >
              Clear all
            </button>
          </div>
          {waitingForUpload && (
            <p
              id={waitingHintId}
              role="status"
              className="text-sm text-muted-foreground"
            >
              Another upload is running. Your files stay queued; start this
              batch when it finishes.
            </p>
          )}
          <ul id={queueListId} className="divide-y rounded-xl border">
            {shownFiles.map(({ key, file, preview, uploaded, progress }) => (
              <li key={key} className="flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {preview ? (
                    <Image
                      src={preview}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 object-cover"
                    />
                  ) : (
                    <File
                      className="h-5 w-5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isUploading
                      ? `${formatBytes(uploaded)} / ${formatBytes(file.size)}`
                      : formatBytes(file.size)}
                  </p>
                  {isUploading && (
                    <Progress
                      value={progress}
                      aria-label={`Upload progress for ${file.name}`}
                      className="mt-2 h-1.5"
                    />
                  )}
                </div>
                {isUploading ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {progress}%
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      remove(key)
                      if (files.length === 1) setQueueExpanded(false)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {files.length > 2 && !isUploading && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Showing {shownFiles.length} of {files.length} files
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] whitespace-normal"
                aria-controls={queueListId}
                aria-expanded={queueExpanded}
                onClick={() => setQueueExpanded((expanded) => !expanded)}
              >
                {queueExpanded
                  ? 'Show fewer files'
                  : `Show all ${files.length} files`}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <ProfilePicker
          value={profileId}
          onChange={setProfileId}
          disabled={isUploading}
          overrides={{
            visibility,
            expiresAt,
            expiryAction,
            password: Boolean(password),
            passwordInvalid: Boolean(password && filePasswordHint(password)),
          }}
        />
        {showFolders && (
          <div className="min-w-0 space-y-2">
            <Label htmlFor="upload-folder">Save to</Label>
            <Select
              value={folderId ?? UNFILED}
              onValueChange={(value) => setFolderId(folderDestination(value))}
              disabled={isUploading || foldersLoading}
            >
              <SelectTrigger id="upload-folder" className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Folder
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <SelectValue placeholder="Choose a folder" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNFILED}>Unfiled</SelectItem>
                {folderId && !selectedFolder && (
                  <SelectItem value={folderId} disabled>
                    {foldersLoading ? 'Loading folder…' : 'Folder unavailable'}
                  </SelectItem>
                )}
                {[...folders]
                  .sort((a, b) =>
                    folderPath(folders, a.id).localeCompare(
                      folderPath(folders, b.id)
                    )
                  )
                  .map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folderPath(folders, folder.id)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {unavailableFolder ? (
              <p className="text-sm text-destructive" role="alert">
                {foldersError
                  ? 'Folders could not be loaded. Try refreshing the page.'
                  : 'This folder is no longer available. Choose another destination.'}
              </p>
            ) : selectedFolder?.shareToken ? (
              <p className="text-xs text-muted-foreground">
                Public files will also appear on this folder’s shared link.
              </p>
            ) : null}
          </div>
        )}
        <CreationOptions
          label={canShare ? 'Upload options' : 'Expiration options'}
          error={password ? filePasswordHint(password) : null}
          passwordField="upload-password"
          customized={Boolean(
            visibility || password || expiresAt !== undefined
          )}
        >
          {canShare && (
            <div className="min-w-0 space-y-2">
              <Label htmlFor="upload-visibility">Visibility</Label>
              <Select
                value={visibility || 'inherit'}
                disabled={isUploading}
                onValueChange={(value: 'PUBLIC' | 'PRIVATE' | 'inherit') =>
                  setVisibility(value === 'inherit' ? undefined : value)
                }
              >
                <SelectTrigger id="upload-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">From upload profile</SelectItem>
                  <SelectItem value="PUBLIC">
                    Public (anyone with the link)
                  </SelectItem>
                  <SelectItem value="PRIVATE">Private (only me)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {canShare && (
            <div className="min-w-0 space-y-2">
              <Label htmlFor="upload-password">
                Password protection{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="upload-password"
                type="password"
                autoComplete="new-password"
                disabled={isUploading}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Leave empty for no password"
                {...filePasswordFieldProps('upload-password-hint', password)}
              />
              <FilePasswordHint id="upload-password-hint" password={password} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="upload-expiration">
              File expiration{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            {/* Sized and filled like the selects above it. */}
            <Button
              id="upload-expiration"
              type="button"
              variant="outline"
              disabled={isUploading}
              className="w-full justify-start bg-transparent px-3 text-left text-base font-normal md:text-sm"
              onClick={() => setIsExpiryModalOpen(true)}
            >
              <CalendarClock
                className="text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">
                {expiresAt
                  ? format(expiresAt, 'PPP p')
                  : expiresAt === null
                    ? 'No expiration for this upload'
                    : 'From upload profile'}
              </span>
            </Button>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <button
                type="button"
                disabled={isUploading}
                data-flare-control="button"
                className={textActionClassName}
                onClick={() => {
                  setExpiresAt(undefined)
                  setExpiryAction(undefined)
                }}
              >
                Use profile expiration
              </button>
              <button
                type="button"
                disabled={isUploading}
                data-flare-control="button"
                className={textActionClassName}
                onClick={() => setExpiresAt(null)}
              >
                No expiration
              </button>
            </div>
            {expiresAt && (
              <p className="text-pretty rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                These files will{' '}
                {expiryAction === 'SET_PRIVATE'
                  ? 'become private'
                  : 'be permanently deleted'}{' '}
                on {format(expiresAt, 'PPPP')}{' '}
                <span className="whitespace-nowrap">
                  {format(expiresAt, 'p')}
                </span>
                .
              </p>
            )}
          </div>
        </CreationOptions>
        {floatingSubmit && typeof document !== 'undefined' ? (
          <>
            <div aria-hidden="true" style={{ height: submitBarHeight + 32 }} />
            {createPortal(
              <div
                ref={setSubmitBarElement}
                role="region"
                aria-label="Upload batch"
                data-upload-submit-bar=""
                className="fixed inset-x-[16px] bottom-[16px] z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-[8px] rounded-xl border border-border bg-overlay p-[10px] shadow-xl shadow-black/20"
              >
                <p className="min-w-0 flex-[1_1_10rem] text-sm text-muted-foreground">
                  {files.length} selected · {formatBytes(totalSize)}
                </p>
                <div className="min-w-0 flex-[1_1_12rem]">{uploadButton}</div>
              </div>,
              document.body
            )}
          </>
        ) : (
          uploadButton
        )}
      </div>

      {completed.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold" role="status">
              Upload complete
            </h2>
            {selectedFolder && (
              <Button asChild variant="ghost" size="sm">
                <Link href={libraryHref({ folder: selectedFolder.id })}>
                  <Folder className="h-4 w-4" aria-hidden="true" />
                  Open folder
                </Link>
              </Button>
            )}
            {completed.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyLinks(
                    completed.map((file) => file.pageUrl || file.url).join('\n')
                  )
                }
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy all links
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {completed.map((file, index) => (
              <li
                key={`${file.url}-${index}`}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <Check
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <a
                  href={file.pageUrl || file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Open ${file.name}`}
                  title={file.url}
                >
                  {file.name}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Copy link for ${file.name}`}
                  onClick={() => copyLinks(file.pageUrl || file.url)}
                >
                  {copiedLink === (file.pageUrl || file.url) ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedLink === (file.pageUrl || file.url)
                    ? 'Copied'
                    : 'Copy link'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExpiryModal
        isOpen={isExpiryModalOpen}
        onOpenChange={setIsExpiryModalOpen}
        onConfirm={async (date, action) => {
          setExpiresAt(date)
          setExpiryAction(action)
        }}
        initialDate={expiresAt ?? null}
        initialAction={
          (expiryAction as ExpiryAction) ??
          (user.defaultFileExpirationAction as ExpiryAction) ??
          ExpiryAction.DELETE
        }
        title="Set file expiration"
        description="Choose when files expire and whether to delete them or make them private."
      />
    </div>
  )
}
