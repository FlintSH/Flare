'use client'

import { useCallback, useEffect, useState } from 'react'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

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

import { useToast } from '@/hooks/use-toast'

const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB chunks

interface UploadFormProps {
  maxSize: number
  formattedMaxSize: string
}

interface FileWithPreview extends File {
  preview?: string
  progress?: number
  uploaded?: number
  uploadStartTime?: number
  uploadSpeed?: number
  estimatedTimeLeft?: number
  chunksUploaded?: number
  totalChunks?: number
}

interface UploadResponse {
  url: string
  name: string
  size: number
  type: string
}

export function UploadForm({ maxSize, formattedMaxSize }: UploadFormProps) {
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [visibility, setVisibility] = useState('PUBLIC')
  const [password, setPassword] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...acceptedFiles.map((file) =>
        Object.assign(file, {
          preview: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
          progress: 0,
          uploaded: 0,
        })
      ),
    ])
  }, [])

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      maxSize,
    })

  useEffect(() => {
    if (fileRejections.length > 0) {
      fileRejections.forEach(({ errors }) => {
        errors.forEach((error) => {
          if (error.code === 'file-too-large') {
            toast({
              title: 'File too large',
              description: 'The file exceeds the maximum upload size limit.',
              variant: 'destructive',
            })
          }
        })
      })
    }
  }, [fileRejections, toast])

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev]
      const file = newFiles[index]
      if (file.preview) {
        URL.revokeObjectURL(file.preview)
      }
      newFiles.splice(index, 1)
      return newFiles
    })
  }

  const updateFileProgress = (
    index: number,
    uploaded: number,
    timestamp: number
  ) => {
    setFiles((prev) => {
      const newFiles = [...prev]
      const file = newFiles[index]

      // Initialize upload start time if not set
      if (!file.uploadStartTime) {
        file.uploadStartTime = timestamp
      }

      // Calculate upload speed using a moving average over the last 5 seconds
      const timeElapsed = (timestamp - file.uploadStartTime) / 1000
      if (timeElapsed > 0) {
        const instantSpeed = uploaded / timeElapsed
        // Use a weighted moving average with more weight on recent speeds
        file.uploadSpeed = file.uploadSpeed
          ? file.uploadSpeed * 0.6 + instantSpeed * 0.4
          : instantSpeed
      }

      file.uploaded = Math.min(uploaded, file.size)
      file.progress = Math.min((uploaded / file.size) * 100, 100)

      // Calculate estimated time remaining using the smoothed speed
      if (file.uploadSpeed && file.uploadSpeed > 0) {
        const bytesRemaining = file.size - file.uploaded
        // Add 10% buffer to the estimate to account for network variations
        file.estimatedTimeLeft = (bytesRemaining / file.uploadSpeed) * 1.1
      }

      return newFiles
    })
  }

  const uploadFileInChunks = async (file: FileWithPreview, index: number) => {
    const uploadId = `${Date.now()}-${Math.random().toString(36).substring(2)}`
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const chunkProgress = new Map<number, number>()

    const updateTotalProgress = () => {
      const totalUploaded = Array.from(chunkProgress.values()).reduce(
        (sum, progress) => sum + progress,
        0
      )
      updateFileProgress(index, totalUploaded, Date.now())
    }

    const uploadChunk = (
      chunkNumber: number
    ): Promise<{
      status: string
      chunksReceived?: number
      totalChunks?: number
    }> => {
      const start = chunkNumber * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      const formData = new FormData()
      formData.append('uploadId', uploadId)
      formData.append('chunkNumber', chunkNumber.toString())
      formData.append('totalChunks', totalChunks.toString())
      formData.append('chunk', chunk)
      formData.append('filename', file.name)
      formData.append('mimeType', file.type)
      formData.append('totalSize', file.size.toString())
      formData.append('visibility', visibility)
      if (password) formData.append('password', password)

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            chunkProgress.set(chunkNumber, event.loaded)
            updateTotalProgress()
          }
        })

        xhr.addEventListener('load', async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const result = JSON.parse(xhr.responseText)
            // Set final progress for this chunk
            chunkProgress.set(chunkNumber, chunk.size)
            updateTotalProgress()
            resolve(result)
          } else {
            reject(new Error(xhr.statusText))
          }
        })

        xhr.addEventListener('error', () => {
          reject(new Error('Network error occurred'))
        })

        xhr.open('POST', '/api/files/chunks')
        xhr.send(formData)
      })
    }

    // Upload all chunks simultaneously
    const chunkResponses = await Promise.all(
      Array.from({ length: totalChunks }, (_, i) => uploadChunk(i))
    )

    // Find the last response (should be the completion response)
    const lastResponse = chunkResponses.find(
      (response) =>
        response.status === 'complete' ||
        response.chunksReceived === response.totalChunks
    )

    if (!lastResponse || lastResponse.status !== 'complete') {
      // If we didn't get a completion response, try one more time to check status
      const finalCheck = await uploadChunk(0)
      if (finalCheck.status !== 'complete') {
        throw new Error(
          'Upload did not complete successfully. Server may still be processing chunks.'
        )
      }
    }
  }

  const uploadFileDirectly = async (file: FileWithPreview, index: number) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('visibility', visibility)
    if (password) formData.append('password', password)

    const xhr = new XMLHttpRequest()
    await new Promise<UploadResponse>((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          updateFileProgress(index, event.loaded, Date.now())
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateFileProgress(index, file.size, Date.now())
          resolve(JSON.parse(xhr.responseText))
        } else {
          if (xhr.status === 413) {
            reject(
              new Error(
                'This file would exceed your storage quota. Please free up some space and try again.'
              )
            )
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`))
          }
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('Network error occurred'))
      })

      xhr.open('POST', '/api/files')
      xhr.send(formData)
    })
  }

  const handleSubmit = async () => {
    if (files.length === 0) return

    setIsUploading(true)
    try {
      for (const [index, file] of files.entries()) {
        // Use chunked upload for files larger than 10MB
        if (file.size > 10 * 1024 * 1024) {
          await uploadFileInChunks(file, index)
        } else {
          await uploadFileDirectly(file, index)
        }

        toast({
          title: 'File uploaded successfully',
          description: file.name,
        })
      }

      // Clear form and refresh files list
      setFiles([])
      setPassword('')
      router.refresh()

      toast({
        title: 'All files uploaded successfully',
        description: 'Your files are now available in your dashboard',
      })
    } catch (error) {
      console.error('Upload error:', error)
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      })

      // If it was a quota error, scroll to the storage usage section
      if (error instanceof Error && error.message.includes('storage quota')) {
        const storageSection = document.querySelector(
          '[data-section="storage"]'
        )
        if (storageSection) {
          storageSection.scrollIntoView({ behavior: 'smooth' })
        }
      }
    } finally {
      setIsUploading(false)
    }
  }

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
            {files.map((file, index) => (
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
                      {file.uploadSpeed &&
                      file.estimatedTimeLeft &&
                      file.progress !== 100
                        ? ` • ${formatBytes(file.uploadSpeed)}/s • ${Math.ceil(file.estimatedTimeLeft)}s remaining`
                        : ''}
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
          <Select value={visibility} onValueChange={setVisibility}>
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
          onClick={handleSubmit}
          disabled={files.length === 0 || isUploading}
        >
          {isUploading ? 'Uploading...' : 'Upload Files'}
        </Button>
      </div>
    </div>
  )
}
