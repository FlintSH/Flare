import { useState } from 'react'

import { useToast } from './use-toast'

export interface UseFileDownloadOptions {
  onComplete?: (filename: string) => void
  onError?: (error: Error) => void
}

export function useFileDownload(options: UseFileDownloadOptions = {}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const { toast } = useToast()

  const downloadFile = async (url: string, customFilename?: string) => {
    setIsDownloading(true)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`)
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)

      // Extract filename from Content-Disposition header or use custom/default
      let filename = customFilename || ''
      const contentDisposition = response.headers.get('content-disposition')
      if (contentDisposition && !customFilename) {
        const filenameMatch = contentDisposition.match(
          /filename=["']?([^"']+)["']?/
        )
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/"/g, '')
        }
      }

      // If no filename was found, use a default
      if (!filename) {
        // Try to determine from URL
        const urlParts = url.split('/')
        filename = urlParts[urlParts.length - 1] || 'download'
      }

      // Create a download link and trigger it
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)

      if (options.onComplete) {
        options.onComplete(filename)
      }

      toast({
        title: 'Success',
        description: `${filename} downloaded successfully`,
      })
    } catch (error) {
      console.error('Download error:', error)
      if (options.onError && error instanceof Error) {
        options.onError(error)
      }

      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to download file',
        variant: 'destructive',
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return {
    isDownloading,
    downloadFile,
  }
}
