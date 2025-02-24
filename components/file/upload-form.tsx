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
        // could prob be done better but it works for now
        file.uploadSpeed = file.uploadSpeed
          ? file.uploadSpeed * 0.6 + instantSpeed * 0.4
          : instantSpeed
      }

      file.uploaded = Math.min(uploaded, file.size)
      file.progress = Math.min((uploaded / file.size) * 100, 100)

      // Calculate estimated time remaining using the smoothed speed
      if (file.uploadSpeed && file.uploadSpeed > 0) {
        const bytesRemaining = file.size - file.uploaded
        // Just a lil buffer to account for network variations
        file.estimatedTimeLeft = (bytesRemaining / file.uploadSpeed) * 1.1
      }

      return newFiles
    })
  }

  const uploadFileInChunks = async (file: FileWithPreview, index: number) => {
    try {
      // Initialize multipart upload
      const initResponse = await fetch('/api/files/chunks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      })

      if (!initResponse.ok) {
        throw new Error('Failed to initialize upload')
      }

      const {
        data: { uploadId, fileKey },
      } = await initResponse.json()

      if (!uploadId || !fileKey) {
        throw new Error('Failed to initialize upload')
      }

      const chunkSize = 5 * 1024 * 1024 // 5MB minimum for S3
      const chunks: Blob[] = []
      const totalChunks = Math.ceil(file.size / chunkSize)
      const chunkProgress = new Map<number, number>()

      // Split file into chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, file.size)
        chunks.push(file.slice(start, end))
      }

      const updateTotalProgress = () => {
        const totalUploaded = Array.from(chunkProgress.values()).reduce(
          (sum, progress) => sum + progress,
          0
        )
        updateFileProgress(index, totalUploaded, Date.now())
      }

      // Upload chunks in batches of 3
      const uploadedParts: { ETag: string; PartNumber: number }[] = []

      for (let i = 0; i < chunks.length; i += 3) {
        const batch = chunks.slice(i, i + 3)
        const batchNumbers = Array.from(
          { length: batch.length },
          (_, j) => i + j + 1
        )

        await Promise.all(
          batch.map(async (chunk, batchIndex) => {
            const partNumber = batchNumbers[batchIndex]
            let retries = 3

            while (retries > 0) {
              try {
                // Upload chunk through our server
                const xhr = new XMLHttpRequest()
                const uploadPromise = new Promise<{ etag: string }>(
                  (resolve, reject) => {
                    xhr.upload.addEventListener('progress', (event) => {
                      if (event.lengthComputable) {
                        chunkProgress.set(partNumber - 1, event.loaded)
                        updateTotalProgress()
                      }
                    })

                    xhr.addEventListener('load', () => {
                      if (xhr.status >= 200 && xhr.status < 300) {
                        const response = JSON.parse(xhr.responseText)
                        resolve(response.data)
                      } else {
                        reject(
                          new Error(
                            `Failed to upload part ${partNumber}: ${xhr.statusText}`
                          )
                        )
                      }
                    })

                    xhr.addEventListener('error', () => {
                      reject(new Error('Network error occurred'))
                    })

                    xhr.open(
                      'PUT',
                      `/api/files/chunks/${uploadId}/part/${partNumber}`
                    )
                    xhr.send(chunk)
                  }
                )

                const { etag } = await uploadPromise

                if (!etag) {
                  throw new Error('Missing ETag in response')
                }

                uploadedParts.push({
                  ETag: etag,
                  PartNumber: partNumber,
                })

                chunkProgress.set(partNumber - 1, chunk.size)
                updateTotalProgress()
                break
              } catch (error) {
                console.error(
                  `Error uploading part ${partNumber}, retries left: ${retries - 1}`,
                  error
                )
                retries--
                if (retries === 0) throw error
                await new Promise((resolve) => setTimeout(resolve, 1000))
              }
            }
          })
        )
      }

      // Complete the multipart upload
      const completeResponse = await fetch(
        `/api/files/chunks/${uploadId}/complete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parts: uploadedParts,
          }),
        }
      )

      if (!completeResponse.ok) {
        throw new Error('Failed to complete upload')
      }

      // Set final progress
      updateFileProgress(index, file.size, Date.now())
    } catch (error) {
      console.error('Upload error:', error)
      throw error
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
