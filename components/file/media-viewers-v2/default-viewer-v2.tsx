'use client'

import { Download, ExternalLink, Eye, File } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface DefaultViewerV2Props {
  file: {
    name: string
    mimeType: string
  }
  fileUrl: string
}

export function DefaultViewerV2({ file, fileUrl }: DefaultViewerV2Props) {
  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = fileUrl
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleOpenRaw = () => {
    window.open(fileUrl, '_blank')
  }

  const getFileIcon = () => {
    if (file.mimeType.startsWith('application/')) {
      return <File className="h-16 w-16 text-blue-500" />
    }
    if (file.mimeType.startsWith('text/')) {
      return <File className="h-16 w-16 text-green-500" />
    }
    return <File className="h-16 w-16 text-gray-500" />
  }

  const getFileTypeDescription = () => {
    if (file.mimeType.includes('zip')) return 'Archive file'
    if (file.mimeType.includes('pdf')) return 'PDF document'
    if (file.mimeType.includes('word')) return 'Word document'
    if (file.mimeType.includes('excel')) return 'Excel spreadsheet'
    if (file.mimeType.includes('powerpoint')) return 'PowerPoint presentation'
    if (file.mimeType.startsWith('application/')) return 'Application file'
    if (file.mimeType.startsWith('text/')) return 'Text file'
    return 'File'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        <div className="bg-background/90 backdrop-blur-sm rounded-2xl shadow-xl border p-8 text-center">
          {/* File Icon */}
          <div className="mb-6">{getFileIcon()}</div>

          {/* File Info */}
          <div className="space-y-3 mb-8">
            <h1 className="text-xl font-semibold truncate">{file.name}</h1>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {getFileTypeDescription()}
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                {file.mimeType}
              </p>
            </div>
          </div>

          {/* Preview Not Available Message */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
              <Eye className="h-5 w-5" />
              <div className="text-left">
                <p className="text-sm font-medium">Preview not available</p>
                <p className="text-xs">
                  This file type cannot be previewed in the browser
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button onClick={handleDownload} className="w-full" size="lg">
              <Download className="h-5 w-5 mr-2" />
              Download File
            </Button>

            <Button
              variant="outline"
              onClick={handleOpenRaw}
              className="w-full"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Raw File
            </Button>
          </div>

          {/* File Details */}
          <div className="mt-6 pt-6 border-t space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Type</p>
                <p className="font-medium">{file.mimeType.split('/')[0]}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Subtype</p>
                <p className="font-medium">{file.mimeType.split('/')[1]}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
