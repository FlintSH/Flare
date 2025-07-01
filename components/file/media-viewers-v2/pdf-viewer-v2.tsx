'use client'

import { useState } from 'react'

import DOMPurify from 'dompurify'
import { Download, ExternalLink, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface PdfViewerV2Props {
  url: string
  title: string
}

export function PdfViewerV2({ url, title }: PdfViewerV2Props) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleLoad = () => {
    setIsLoading(false)
  }

  const handleError = () => {
    setError('Failed to load PDF')
    setIsLoading(false)
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = url
    link.download = title
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleOpenInNewTab = () => {
    window.open(url, '_blank')
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4 p-8">
          <FileText className="h-16 w-16 text-red-500 mx-auto" />
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Button variant="outline" onClick={handleOpenInNewTab}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in New Tab
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
              <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="font-medium truncate max-w-xs sm:max-w-md">
                {title}
              </h1>
              <p className="text-xs text-muted-foreground">PDF Document</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Download</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenInNewTab}>
              <ExternalLink className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">New Tab</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <div className="text-center space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
            <p className="text-muted-foreground">Loading PDF...</p>
          </div>
        </div>
      )}

      {/* PDF Viewer */}
      <div className="relative h-screen overflow-hidden">
        <iframe
          src={DOMPurify.sanitize(url)}
          className="w-full h-full border-0"
          onLoad={handleLoad}
          onError={handleError}
          title={title}
        />
      </div>

      {/* Mobile fallback message */}
      <div className="md:hidden bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800 p-4">
        <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
          <FileText className="h-5 w-5" />
          <div>
            <p className="text-sm font-medium">PDF viewing on mobile</p>
            <p className="text-xs">
              For the best experience, download the PDF or open in a new tab
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={handleDownload} className="flex-1">
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenInNewTab}
            className="flex-1"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open
          </Button>
        </div>
      </div>
    </div>
  )
}
