'use client'

import { useEffect, useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { ExpiryAction } from '@/types/events'
import { $Enums } from '@prisma/client'
import { format } from 'date-fns'
import {
  CalendarClock,
  Check,
  Copy,
  File,
  Folder,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'

import { PermissionGate } from '@/components/roles/permission-gate'
import { ExpiryModal } from '@/components/shared/expiry-modal'
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

import { folderPath } from '@/lib/folders/navigation'
import { cn, formatBytes } from '@/lib/utils'

import { UploadResponse, useFileUpload } from '@/hooks/use-file-upload'
import { useFolders } from '@/hooks/use-folders'
import { useToast } from '@/hooks/use-toast'

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
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const requestedFolder = searchParams.get('folder')
  const initialFolder = requestedFolder === 'unfiled' ? null : requestedFolder
  const { folders, loading: foldersLoading, error: foldersError } = useFolders()
  const {
    files,
    isUploading,
    onDrop,
    removeFile,
    clearFiles,
    uploadFiles,
    visibility,
    setVisibility,
    password,
    setPassword,
    expiresAt,
    setExpiresAt,
    expiryAction,
    setExpiryAction,
    profileId,
    setProfileId,
    folderId,
    setFolderId,
  } = useFileUpload({
    maxSize,
    folderId: initialFolder,
    onUploadComplete: (responses) => {
      setCompleted((previous) => [...responses, ...previous])
      setUploadError('')
      window.dispatchEvent(new Event('flare:files-changed'))
    },
    onUploadError: setUploadError,
  })
  useEffect(() => {
    setFolderId(initialFolder)
  }, [initialFolder, setFolderId])
  const selectedFolder = folders.find((folder) => folder.id === folderId)
  const unavailableFolder = !!folderId && !selectedFolder && !foldersLoading

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles, rejections) => {
      onDrop(acceptedFiles)
      setUploadError(
        rejections.length
          ? `${rejections.length} ${rejections.length === 1 ? 'file could' : 'files could'} not be added. Each file must be ${formattedMaxSize} or smaller.`
          : ''
      )
    },
    maxSize,
    disabled: isUploading,
  })
  const totalSize = files.reduce((total, file) => total + file.size, 0)

  const copyLinks = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedLink(value)
      toast({ title: 'Copied to clipboard' })
    } catch {
      toast({
        title: 'Could not copy link',
        description: 'Open the file to copy its address.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div
        {...getRootProps({
          role: 'button',
          'aria-label': 'Choose files to upload',
          'aria-disabled': isUploading,
        })}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/20 px-4 py-8 text-center outline-none transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isDragActive && 'border-primary bg-primary/5',
          isUploading && 'pointer-events-none opacity-60'
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className="mb-3 h-9 w-9 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-base font-medium">
          {isDragActive
            ? 'Drop your files here'
            : 'Drag and drop files here, or click to select'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Maximum file size: {formattedMaxSize}
        </p>
      </div>

      {uploadError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
        >
          {uploadError}
        </p>
      )}

      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Selected files{' '}
              <span className="font-normal text-muted-foreground">
                ({files.length} · {formatBytes(totalSize)})
              </span>
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFiles}
              disabled={isUploading}
            >
              Clear all
            </Button>
          </div>
          <ul className="divide-y rounded-lg border">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.lastModified}-${index}`}
                className="flex items-center gap-3 p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {file.preview ? (
                    <Image
                      src={file.preview}
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
                      ? `${formatBytes(file.uploaded)} / ${formatBytes(file.size)}`
                      : formatBytes(file.size)}
                  </p>
                  {isUploading && (
                    <Progress
                      value={Math.min(file.progress, 100)}
                      aria-label={`Upload progress for ${file.name}`}
                      className="mt-2 h-1.5"
                    />
                  )}
                </div>
                {isUploading ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.min(file.progress, 100)}%
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeFile(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {(folders.length > 0 || folderId) && (
          <div className="space-y-2">
            <Label htmlFor="upload-folder">Save to</Label>
            <Select
              value={folderId ?? 'unfiled'}
              onValueChange={(value) =>
                setFolderId(value === 'unfiled' ? null : value)
              }
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
                <SelectItem value="unfiled">Unfiled</SelectItem>
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
        <ProfilePicker
          value={profileId}
          onChange={setProfileId}
          disabled={isUploading}
        />
        <PermissionGate permission="files.share">
          <div className="space-y-2">
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
        </PermissionGate>
        <PermissionGate permission="files.share">
          <div className="space-y-2">
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
            />
          </div>
        </PermissionGate>
        <div className="space-y-2">
          <Label htmlFor="upload-expiration">
            File expiration{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Button
            id="upload-expiration"
            type="button"
            variant="outline"
            disabled={isUploading}
            className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left font-normal"
            onClick={() => setIsExpiryModalOpen(true)}
          >
            <CalendarClock className="mr-2 h-4 w-4 shrink-0" />
            {expiresAt
              ? format(expiresAt, 'PPP p')
              : expiresAt === null
                ? 'No expiration for this upload'
                : 'From upload profile'}
          </Button>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button
              type="button"
              disabled={isUploading}
              className="min-h-8 rounded-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
              className="min-h-8 rounded-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              onClick={() => setExpiresAt(null)}
            >
              No expiration
            </button>
          </div>
          {expiresAt && (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              These files will{' '}
              {expiryAction === 'SET_PRIVATE'
                ? 'become private'
                : 'be permanently deleted'}{' '}
              on {format(expiresAt, 'PPPP p')}.
            </p>
          )}
        </div>
        <Button
          className="w-full"
          onClick={() => {
            setUploadError('')
            void uploadFiles()
          }}
          disabled={
            files.length === 0 ||
            isUploading ||
            unavailableFolder ||
            (!!folderId && foldersLoading)
          }
        >
          {isUploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {isUploading
            ? 'Uploading…'
            : files.length
              ? `Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}`
              : 'Upload files'}
        </Button>
      </div>

      {completed.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium" role="status">
              Upload complete
            </h2>
            {selectedFolder && (
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/dashboard?folder=${encodeURIComponent(selectedFolder.id)}`}
                >
                  <Folder className="mr-2 h-4 w-4" aria-hidden="true" />
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
                <Copy className="mr-2 h-4 w-4" />
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
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
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
