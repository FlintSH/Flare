import { useState } from 'react'

import { exportUrls, newExportId } from '@/lib/users/export-id'

import { useToast } from './use-toast'

export function useDataExport() {
  // The percentage of files written into the archive; null when idle.
  const [progress, setProgress] = useState<number | null>(null)
  const { toast } = useToast()

  const handleExport = async () => {
    setProgress(0)
    const urls = exportUrls(newExportId())
    let events: EventSource | null = null
    try {
      const response = await fetch(urls.download, { cache: 'no-store' })

      if (!response.ok) {
        throw new Error(`Export failed with status: ${response.status}`)
      }

      // The export is running once its response arrives, so follow it now.
      events = new EventSource(urls.progress)
      events.onmessage = (event) => setProgress(JSON.parse(event.data).progress)
      // The stream ends when the export does; don't let the browser reopen it.
      events.onerror = () => events?.close()

      const blob = await response.blob()

      if (blob.size === 0) {
        throw new Error('No data received from server')
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        response.headers
          .get('content-disposition')
          ?.match(/filename="?([^"]*)"?/)?.[1] || 'flare-data-export.zip'
      document.body.appendChild(a)
      a.click()

      setTimeout(() => {
        URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }, 100)

      toast({
        title: 'Success',
        description: 'Your data has been exported successfully',
        variant: 'default',
      })
    } catch (error) {
      console.error('Export error:', error)
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to export data',
        variant: 'destructive',
      })
    } finally {
      events?.close()
      setProgress(null)
    }
  }

  return {
    isExporting: progress !== null,
    progress: progress ?? 0,
    handleExport,
  }
}
