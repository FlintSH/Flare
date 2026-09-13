'use client'

import { useState } from 'react'

import Image from 'next/image'

import { ExpiryAction } from '@/types/events'
import { $Enums } from '@prisma/client'
import { format } from 'date-fns'
import { CalendarIcon, FileIcon, UploadIcon, XIcon } from 'lucide-react'
import { useDropzone } from 'react-dropzone'

import { ExpiryModal } from '@/components/shared/expiry-modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

import { formatBytes } from '@/lib/utils'

import { FileWithPreview, useFileUpload } from '@/hooks/use-file-upload'

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

  const {
    files,
    isUploading,
    onDrop,
    removeFile,
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
  })

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize,
  })

  return (
    <div className="space-y-8">
      <Card
        {...getRootProps()}
        className={`p-8 border-2 border-dashed transition-colors ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-muted'
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center text-center">
          <UploadIcon className="w-12 h-12 mb-4 text-muted-foreground" />
          <p className="text-lg font-medium">
            {isDragActive
              ? 'Drop the files here'
              : 'Drag and drop files here, or click to select files'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Maximum file size: {formattedMaxSize}
          </p>
        </div>
      </Card>

      {files.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Selected Files</h2>
          <div className="space-y-2">
            {files.map((file: FileWithPreview, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 rounded-lg bg-muted"
              >
                {file.preview ? (
                  <Image
                    src={file.preview}
                    alt={file.name}
                    width={48}
                    height={48}
                    className="object-cover rounded"
                  />
                ) : (
                  <FileIcon className="w-12 h-12 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {file.uploaded !== undefined
                        ? `${formatBytes(file.uploaded)} / ${formatBytes(file.size)}`
                        : formatBytes(file.size)}
                    </p>
                    {file.progress !== undefined && file.progress > 0 && (
                      <Progress
                        value={Math.min(file.progress, 100)}
                        className="h-1"
                      />
                    )}
                  </div>
                </div>
                {!isUploading && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(index)}
                  >
                    <XIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <ProfilePicker
          value={profileId}
          onChange={setProfileId}
          disabled={isUploading}
        />
        <div className="space-y-2">
          <Label>Visibility</Label>
          <Select
            value={visibility || 'inherit'}
            onValueChange={(value: 'PUBLIC' | 'PRIVATE' | 'inherit') =>
              setVisibility(value === 'inherit' ? undefined : value)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">From upload profile</SelectItem>
              <SelectItem value="PUBLIC">Public</SelectItem>
              <SelectItem value="PRIVATE">Private (only me)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Password Protection (Optional)</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave empty for no password"
          />
        </div>

        <div className="space-y-2">
          <Label>File Expiration (Optional)</Label>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-left font-normal"
            onClick={() => setIsExpiryModalOpen(true)}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {expiresAt ? (
              <span>Expires: {format(expiresAt, 'PPP p')}</span>
            ) : expiresAt === null ? (
              'No expiration for this upload'
            ) : (
              'From upload profile'
            )}
          </Button>

          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setExpiresAt(undefined)
                setExpiryAction(undefined)
              }}
            >
              Use profile expiration
            </button>
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setExpiresAt(null)}
            >
              No expiration
            </button>
          </div>
          {expiresAt && (
            <div className="rounded-md bg-orange-50 dark:bg-orange-950/20 p-3 border border-orange-200 dark:border-orange-800/50">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                  {expiryAction === 'SET_PRIVATE'
                    ? 'Privacy change scheduled'
                    : 'Expiration scheduled'}
                </p>
              </div>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                File will{' '}
                {expiryAction === 'SET_PRIVATE'
                  ? 'become private'
                  : 'be permanently deleted'}{' '}
                on {format(expiresAt, 'PPPP p')}
              </p>
            </div>
          )}
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={uploadFiles}
          disabled={files.length === 0 || isUploading}
        >
          {isUploading ? 'Uploading...' : 'Upload Files'}
        </Button>
      </div>

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
        title="Set File Expiration"
        description="Choose when files expire and whether to delete them or make them private."
      />
    </div>
  )
}
