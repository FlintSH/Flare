'use client'

import { useState } from 'react'

import Image from 'next/image'

import { ExpiryAction } from '@/types/events'
import { format } from 'date-fns'
import {
  CalendarIcon,
  FileIcon,
  PauseIcon,
  PlayIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
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

import { formatBytes } from '@/lib/utils'

import { FileWithPreview, useFileUpload } from '@/hooks/use-file-upload'

interface UploadFormProps {
  maxSize: number
  formattedMaxSize: string
}

export function UploadForm({ maxSize, formattedMaxSize }: UploadFormProps) {
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)

  const {
    files,
    isUploading,
    isPaused,
    onDrop,
    removeFile,
    uploadFiles,
    togglePause,
    formatSpeed,
    visibility,
    setVisibility,
    password,
    setPassword,
    expiresAt,
    setExpiresAt,
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
                    <div className="flex justify-between items-center text-sm text-muted-foreground">
                      <span>
                        {file.uploaded !== undefined
                          ? `${formatBytes(file.uploaded)} / ${formatBytes(file.size)}`
                          : formatBytes(file.size)}
                      </span>
                      {file.uploadSpeed !== undefined &&
                        file.uploadSpeed > 0 &&
                        isUploading && (
                          <span className="text-xs">
                            {formatSpeed(file.uploadSpeed)}
                          </span>
                        )}
                    </div>
                    {file.progress !== undefined && file.progress > 0 && (
                      <div className="space-y-1">
                        <Progress
                          value={Math.min(file.progress, 100)}
                          className="h-1"
                        />
                        <p className="text-xs text-muted-foreground">
                          {file.progress}%
                          {isPaused &&
                            file.progress > 0 &&
                            file.progress < 100 && (
                              <span className="ml-2 text-orange-500">
                                (Paused)
                              </span>
                            )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                {isUploading && file.progress > 0 && file.progress < 100 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={togglePause}
                    title={isPaused ? 'Resume upload' : 'Pause upload'}
                  >
                    {isPaused ? (
                      <PlayIcon className="w-4 h-4" />
                    ) : (
                      <PauseIcon className="w-4 h-4" />
                    )}
                  </Button>
                ) : !isUploading ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(index)}
                  >
                    <XIcon className="w-4 h-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(value: 'PUBLIC' | 'PRIVATE') =>
              setVisibility(value)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
            ) : (
              'Set expiration date'
            )}
          </Button>

          {expiresAt && (
            <div className="rounded-md bg-orange-50 dark:bg-orange-950/20 p-3 border border-orange-200 dark:border-orange-800/50">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                  Auto-delete scheduled
                </p>
              </div>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                File will be permanently deleted on{' '}
                {format(expiresAt, 'PPPP p')}
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
        onConfirm={async (date, _action) => {
          setExpiresAt(date)
        }}
        initialDate={expiresAt}
        initialAction={ExpiryAction.DELETE}
        title="Set File Expiration"
        description="Configure when uploaded files should be automatically deleted"
      />
    </div>
  )
}
