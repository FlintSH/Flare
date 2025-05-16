import { useState } from 'react'

import { useToast } from './use-toast'

export function useDataExport() {
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'preparing' | 'downloading'>(
    'idle'
  )
  const { toast } = useToast()

  const handleExport = async () => {
    setIsExporting(true)
    setExportProgress(0)
    setDownloadProgress(0)
    setStatus('preparing')

    let eventSource: EventSource | null = null
    try {
      // Start listening for export progress updates
      eventSource = new EventSource('/api/profile/export/progress')
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)
        setExportProgress(data.progress)
        if (data.progress === 100) {
          eventSource?.close()
          setStatus('downloading')
        }
      }

      const response = await fetch('/api/profile/export')
      if (!response.ok) throw new Error('Export failed')

      // Get the total size if available
      const contentLength = response.headers.get('Content-Length')
      const totalSize = contentLength ? parseInt(contentLength, 10) : null

      // Create response reader
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Failed to create reader')

      // Read the stream
      const chunks: Uint8Array[] = []
      let receivedLength = 0
      let lastProgressUpdate = Date.now()
      let lastChunkTime = Date.now()
      let bytesPerSecond = 0
      let highestProgress = 0

      while (true) {
        const { done, value } = await reader.read()
        const now = Date.now()

        if (done) {
          setDownloadProgress(100)
          break
        }

        chunks.push(value)
        receivedLength += value.length

        // Calculate download speed with smoother averaging
        const timeDiff = now - lastChunkTime
        if (timeDiff > 0) {
          const instantSpeed = (value.length / timeDiff) * 1000
          bytesPerSecond =
            bytesPerSecond === 0
              ? instantSpeed
              : bytesPerSecond * 0.8 + instantSpeed * 0.2
        }
        lastChunkTime = now

        // Update progress at most every 100ms
        if (now - lastProgressUpdate > 100) {
          let newProgress
          if (totalSize) {
            // If we have Content-Length, use it for accurate progress
            newProgress = Math.round((receivedLength / totalSize) * 100)
          } else {
            // If no Content-Length, estimate based on received data and speed
            const estimatedSecondsLeft = bytesPerSecond > 0 ? 1 : 0 // More conservative estimate
            const estimatedTotalSize =
              receivedLength + bytesPerSecond * estimatedSecondsLeft
            newProgress = Math.min(
              Math.round((receivedLength / estimatedTotalSize) * 100),
              99
            )
          }

          // Only update if the new progress is higher
          if (newProgress > highestProgress) {
            highestProgress = newProgress
            setDownloadProgress(newProgress)
          }
          lastProgressUpdate = now
        }
      }

      // Create and download the blob
      const blob = new Blob(chunks, { type: 'application/zip' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-data-export.zip'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Export error:', error)
      toast({
        title: 'Error',
        description: 'Failed to export data',
        variant: 'destructive',
      })
    } finally {
      eventSource?.close()
      setIsExporting(false)
      setExportProgress(0)
      setDownloadProgress(0)
      setStatus('idle')
    }
  }

  return {
    isExporting,
    exportProgress,
    downloadProgress,
    status,
    handleExport,
  }
}
