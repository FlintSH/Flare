import React, { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { Progress } from '@/components/ui/progress'
import { ToastAction } from '@/components/ui/toast'

import { useToast } from './use-toast'

export type FileWithPreview = File & {
  preview?: string
  progress: number
  uploaded: number
}

export type UploadResponse = {
  url: string
  name: string
  size: number
  type: string
}

export type FileUploadOptions = {
  maxSize?: number
  visibility?: 'PUBLIC' | 'PRIVATE'
  password?: string
  expiresAt?: Date | null
  onUploadComplete?: (responses: UploadResponse[]) => void
  onUploadError?: (error: string) => void
}

export function useFileUpload(options: FileUploadOptions = {}) {
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    options.visibility || 'PUBLIC'
  )
  const [password, setPassword] = useState(options.password || '')
  const [expiresAt, setExpiresAt] = useState<Date | null>(
    options.expiresAt || null
  )
  const progressToastRef = React.useRef<ReturnType<typeof toast> | null>(null)

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

  useEffect(() => {
    return () => {
      for (const file of files) {
        if (file.preview) {
          URL.revokeObjectURL(file.preview)
        }
      }
    }
  }, [files])

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

  const clearFiles = () => {
    for (const file of files) {
      if (file.preview) {
        URL.revokeObjectURL(file.preview)
      }
    }
    setFiles([])
  }

  const updateFileProgress = (index: number, uploaded: number, now: number) => {
    setFiles((prev) => {
      const newFiles = [...prev]
      const file = newFiles[index]
      file.progress = Math.min(100, Math.round((uploaded / file.size) * 100))
      file.uploaded = uploaded
      return [...newFiles]
    })

    if (progressToastRef.current && files[index]) {
      const progress = Math.min(
        100,
        Math.round((uploaded / files[index].size) * 100)
      )
      progressToastRef.current.update({
        id: progressToastRef.current.id,
        title: 'Uploading...',
        description: (
          <div className="space-y-2">
            <p className="text-sm">{files[index].name}</p>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">{progress}%</p>
          </div>
        ),
      })
    }
  }

  const uploadFileInChunks = async (file: FileWithPreview, index: number) => {
    const MAX_CONCURRENT_UPLOADS = 10
    const MAX_RETRIES = 3
    const INITIAL_RETRY_DELAY = 1000

    try {
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

      const chunkSize = 5 * 1024 * 1024
      const totalChunks = Math.ceil(file.size / chunkSize)
      const chunkProgress = new Map<number, number>()

      const chunks: Array<{ blob: Blob; partNumber: number }> = []
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, file.size)
        chunks.push({
          blob: file.slice(start, end),
          partNumber: i + 1,
        })
      }

      const updateTotalProgress = () => {
        const totalUploaded = Array.from(chunkProgress.values()).reduce(
          (sum, progress) => sum + progress,
          0
        )
        updateFileProgress(index, totalUploaded, Date.now())
      }

      const uploadChunkWithRetry = async (
        chunk: Blob,
        partNumber: number,
        retryCount = 0
      ): Promise<{ ETag: string; PartNumber: number }> => {
        try {
          return await new Promise<{ ETag: string; PartNumber: number }>(
            (resolve, reject) => {
              const xhr = new XMLHttpRequest()

              xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                  chunkProgress.set(partNumber, event.loaded)
                  updateTotalProgress()
                }
              })

              xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  chunkProgress.set(partNumber, chunk.size)
                  updateTotalProgress()
                  try {
                    const response = JSON.parse(xhr.responseText)
                    resolve({
                      ETag: response.data.etag,
                      PartNumber: partNumber,
                    })
                  } catch (error) {
                    reject(new Error('Failed to parse response'))
                  }
                } else {
                  reject(new Error(`Upload failed: ${xhr.statusText}`))
                }
              })

              xhr.addEventListener('error', () => {
                reject(new Error('Network error occurred'))
              })

              xhr.addEventListener('abort', () => {
                reject(new Error('Upload aborted'))
              })

              xhr.open(
                'PUT',
                `/api/files/chunks/${uploadId}/part/${partNumber}`
              )
              xhr.send(chunk)
            }
          )
        } catch (error) {
          if (retryCount < MAX_RETRIES) {
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount)
            await new Promise((resolve) => setTimeout(resolve, delay))
            return uploadChunkWithRetry(chunk, partNumber, retryCount + 1)
          }
          throw error
        }
      }

      const uploadedParts: { ETag: string; PartNumber: number }[] = []
      const uploadChunk = async (blob: Blob, partNumber: number) => {
        const result = await uploadChunkWithRetry(blob, partNumber)
        uploadedParts.push(result)
      }

      const parallelLimit = async <T,>(
        items: T[],
        limit: number,
        fn: (item: T) => Promise<void>
      ): Promise<void> => {
        const executing: Promise<void>[] = []
        for (const item of items) {
          const promise = fn(item).then(() => {
            executing.splice(executing.indexOf(promise), 1)
          })
          executing.push(promise)
          if (executing.length >= limit) {
            await Promise.race(executing)
          }
        }
        await Promise.all(executing)
      }

      await parallelLimit(
        chunks,
        MAX_CONCURRENT_UPLOADS,
        async ({ blob, partNumber }) => {
          await uploadChunk(blob, partNumber)
        }
      )

      const completeResponse = await fetch(
        `/api/files/chunks/${uploadId}/complete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parts: uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber),
            visibility,
            password: password || null,
            expiresAt: expiresAt?.toISOString() || null,
          }),
        }
      )

      if (!completeResponse.ok) {
        throw new Error('Failed to complete upload')
      }

      const result = await completeResponse.json()
      return result.data || result
    } catch (error) {
      console.error('Error in chunk upload:', error)
      throw error
    }
  }

  const uploadFileDirectly = async (file: FileWithPreview, index: number) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('visibility', visibility)
    if (password) formData.append('password', password)
    if (expiresAt) formData.append('expiresAt', expiresAt.toISOString())

    const xhr = new XMLHttpRequest()
    return await new Promise<UploadResponse>((resolve, reject) => {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          updateFileProgress(index, event.loaded, Date.now())
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateFileProgress(index, file.size, Date.now())
          const response = JSON.parse(xhr.responseText)
          resolve(response.data || response)
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

  const uploadFiles = async () => {
    if (files.length === 0) return

    setIsUploading(true)
    const responses: UploadResponse[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        let response: UploadResponse

        progressToastRef.current = toast({
          title: 'Uploading...',
          description: (
            <div className="space-y-2">
              <p className="text-sm">{file.name}</p>
              <Progress value={0} className="h-2" />
              <p className="text-xs text-muted-foreground">0%</p>
            </div>
          ),
          duration: Infinity,
        })

        if (file.size > 10 * 1024 * 1024) {
          response = await uploadFileInChunks(file, i)
        } else {
          response = await uploadFileDirectly(file, i)
        }

        responses.push(response)

        progressToastRef.current?.dismiss()
        progressToastRef.current = null
      }

      if (responses.length === 1) {
        const file = responses[0]
        toast({
          title: 'Upload Complete',
          description: `Successfully uploaded ${file.name}`,
          action: (
            <div className="flex gap-2">
              <ToastAction
                altText="Open file"
                onClick={() => window.open(file.url, '_blank')}
              >
                Open
              </ToastAction>
              <ToastAction
                altText="Copy link"
                onClick={() => {
                  navigator.clipboard.writeText(file.url)
                  toast({
                    title: 'Link copied',
                    description: 'File link copied to clipboard',
                  })
                }}
              >
                Copy Link
              </ToastAction>
            </div>
          ),
        })
      } else {
        toast({
          title: 'Upload Complete',
          description: `Successfully uploaded ${responses.length} files`,
          action: (
            <ToastAction
              altText="Copy all links"
              onClick={() => {
                const links = responses.map((r) => r.url).join('\n')
                navigator.clipboard.writeText(links)
                toast({
                  title: 'Links copied',
                  description: 'All file links copied to clipboard',
                })
              }}
            >
              Copy All Links
            </ToastAction>
          ),
        })
      }

      if (options.onUploadComplete) {
        options.onUploadComplete(responses)
      }

      clearFiles()
      router.refresh()
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Upload failed'
      toast({
        title: 'Upload Failed',
        description: errorMessage,
        variant: 'destructive',
      })

      if (options.onUploadError) {
        options.onUploadError(errorMessage)
      }
    } finally {
      setIsUploading(false)
    }
  }

  return {
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
  }
}
