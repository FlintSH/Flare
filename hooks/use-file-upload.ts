import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

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
  }

  const uploadFileInChunks = async (file: FileWithPreview, index: number) => {
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
      const chunks: Blob[] = []
      const totalChunks = Math.ceil(file.size / chunkSize)
      const chunkProgress = new Map<number, number>()

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

      const uploadedParts: { ETag: string; PartNumber: number }[] = []
      const batchSize = 3
      let completed = 0

      for (let i = 0; i < Math.ceil(chunks.length / batchSize); i++) {
        const batchStart = i * batchSize
        const batchEnd = Math.min(batchStart + batchSize, chunks.length)
        const batch = chunks.slice(batchStart, batchEnd)

        const promises = batch.map(async (chunk, batchIndex) => {
          const partNumber = batchStart + batchIndex + 1
          const formData = new FormData()
          formData.append('partNumber', partNumber.toString())
          formData.append('uploadId', uploadId)
          formData.append('key', fileKey)
          formData.append('chunk', chunk)

          const xhr = new XMLHttpRequest()
          await new Promise<{ ETag: string; PartNumber: number }>(
            (resolve, reject) => {
              xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                  chunkProgress.set(partNumber, event.loaded)
                  updateTotalProgress()
                }
              })

              xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  completed++
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

              xhr.open(
                'PUT',
                `/api/files/chunks/${uploadId}/part/${partNumber}`
              )
              xhr.send(chunk)
            }
          ).then((response) => {
            uploadedParts.push(response)
          })
        })

        await Promise.all(promises)
      }

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

      return await completeResponse.json()
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

  const uploadFiles = async () => {
    if (files.length === 0) return

    setIsUploading(true)
    const responses: UploadResponse[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        let response: UploadResponse

        if (file.size > 10 * 1024 * 1024) {
          response = await uploadFileInChunks(file, i)
        } else {
          response = await uploadFileDirectly(file, i)
        }

        responses.push(response)
      }

      toast({
        title: 'Upload Complete',
        description: `Successfully uploaded ${files.length} file${
          files.length === 1 ? '' : 's'
        }`,
      })

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
