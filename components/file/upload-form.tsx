'use client'

import { useState } from 'react'

import Image from 'next/image'

import { ExpiryAction } from '@/types/events'
import { $Enums } from '@prisma/client'
import { format } from 'date-fns'
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  File,
  FolderOpen,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'

import {
  WorkspaceNote,
  WorkspacePanel,
} from '@/components/dashboard/page-shell'
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

import { cn, formatBytes } from '@/lib/utils'

import { UploadResponse, useFileUpload } from '@/hooks/use-file-upload'
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
  } = useFileUpload({
    maxSize,
    onUploadComplete: (responses) => {
      setCompleted((previous) => [...responses, ...previous])
      setUploadError('')
    },
    onUploadError: setUploadError,
  })

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
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <WorkspacePanel
          title="Choose your files"
          description="Add one file or a whole collection. Your sharing choices apply to every file in this upload."
        >
          <div
            {...getRootProps({
              role: 'button',
              'aria-label': 'Choose files to upload',
              'aria-disabled': isUploading,
            })}
            className={cn(
              'flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-10 text-center outline-none transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isDragActive && 'border-primary bg-primary/5',
              isUploading && 'pointer-events-none opacity-60'
            )}
          >
            <input {...getInputProps()} />
            <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
              <Upload className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="text-lg font-semibold tracking-tight">
              {isDragActive
                ? 'Drop your files here'
                : 'Drag files here to get started'}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Or select files from your device. Up to {formattedMaxSize} per
              file.
            </p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium shadow-sm">
              <FolderOpen className="h-4 w-4" aria-hidden="true" /> Browse files
            </span>
          </div>

          {uploadError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{uploadError}</p>
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {isUploading ? 'Uploading your files' : 'Ready to upload'}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {files.length} {files.length === 1 ? 'file' : 'files'} ·{' '}
                    {formatBytes(totalSize)} total
                  </p>
                </div>
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
              <ul className="divide-y rounded-xl border">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.lastModified}-${index}`}
                    className="flex items-center gap-3 p-3 sm:p-4"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {file.preview ? (
                        <Image
                          src={file.preview}
                          alt=""
                          width={44}
                          height={44}
                          className="h-11 w-11 object-cover"
                        />
                      ) : (
                        <File
                          className="h-5 w-5 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-medium"
                        title={file.name}
                      >
                        {file.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
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
        </WorkspacePanel>

        {completed.length > 0 ? (
          <WorkspacePanel
            title="Your files are ready"
            description="Upload complete. Open a file or copy its link to share."
            action={
              completed.length > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyLinks(
                      completed
                        .map((file) => file.copyText || file.url)
                        .join('\n')
                    )
                  }
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy all links
                </Button>
              ) : undefined
            }
          >
            <ul className="divide-y rounded-xl border">
              {completed.map((file, index) => (
                <li
                  key={`${file.url}-${index}`}
                  className="flex flex-wrap items-center gap-3 p-4"
                >
                  <CheckCircle2
                    className="h-5 w-5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 basis-40">
                    <p
                      className="truncate text-sm font-medium"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {file.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Copy link for ${file.name}`}
                      onClick={() => copyLinks(file.copyText || file.url)}
                    >
                      {copiedLink === (file.copyText || file.url) ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      {copiedLink === (file.copyText || file.url)
                        ? 'Copied'
                        : 'Copy link'}
                    </Button>
                    <Button asChild variant="ghost" size="icon">
                      <a
                        href={file.pageUrl || file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${file.name}`}
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </WorkspacePanel>
        ) : (
          <WorkspaceNote icon={ShieldCheck} title="Share on your terms">
            Use a saved upload profile for consistent defaults, or adjust access
            and expiration for this batch. You can manage your files in the
            library after uploading.
          </WorkspaceNote>
        )}
      </div>

      <WorkspacePanel
        title="Sharing & access"
        description="Start with your saved defaults, then adjust this upload."
        className="xl:sticky xl:top-24"
      >
        <div className="space-y-5">
          <ProfilePicker
            value={profileId}
            onChange={setProfileId}
            disabled={isUploading}
          />
          <div className="space-y-2 border-t pt-5">
            <Label htmlFor="upload-visibility">Who can open these files?</Label>
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
                <SelectItem value="PUBLIC">Anyone with the link</SelectItem>
                <SelectItem value="PRIVATE">Only me</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Private files are only accessible while signed in to your account.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="upload-password">
              Password{' '}
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
              placeholder="Add a password"
            />
            <p className="text-xs text-muted-foreground">
              Anyone opening a protected file will need this password.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Expiration</Label>
            <Button
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
            <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
              <button
                type="button"
                disabled={isUploading}
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
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
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                onClick={() => setExpiresAt(null)}
              >
                No expiration
              </button>
            </div>
            {expiresAt && (
              <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                These files will{' '}
                {expiryAction === 'SET_PRIVATE'
                  ? 'become private'
                  : 'be permanently deleted'}{' '}
                on {format(expiresAt, 'PPPP p')}.
              </p>
            )}
          </div>
          <div className="border-t pt-5">
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                setUploadError('')
                void uploadFiles()
              }}
              disabled={files.length === 0 || isUploading}
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
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {files.length
                ? `${formatBytes(totalSize)} ready to upload`
                : 'Choose files to enable upload.'}
            </p>
          </div>
        </div>
      </WorkspacePanel>

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
