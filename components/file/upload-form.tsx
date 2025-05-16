'use client'

import Image from 'next/image'

import { FileIcon, UploadIcon, XIcon } from 'lucide-react'
import { useDropzone } from 'react-dropzone'

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
import { useToast } from '@/hooks/use-toast'

interface UploadFormProps {
  maxSize: number
  formattedMaxSize: string
}

export function UploadForm({ maxSize, formattedMaxSize }: UploadFormProps) {
  const { toast } = useToast()

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
  } = useFileUpload({
    maxSize,
    onUploadComplete: (responses) => {
      toast({
        title: 'All files uploaded successfully',
        description: `Successfully uploaded ${responses.length} file${
          responses.length === 1 ? '' : 's'
        }`,
      })
    },
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

        <Button
          className="w-full"
          size="lg"
          onClick={uploadFiles}
          disabled={files.length === 0 || isUploading}
        >
          {isUploading ? 'Uploading...' : 'Upload Files'}
        </Button>
      </div>
    </div>
  )
}
