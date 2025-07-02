'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import { Copy, Download, ExternalLink, Link, ScanText } from 'lucide-react'

import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'

import { useFileActions } from '@/hooks/use-file-actions'
import { useToast } from '@/hooks/use-toast'

interface FileActionsProps {
  urlPath: string
  name: string
  verifiedPassword?: string
  showOcr?: boolean
  isTextBased?: boolean
  content?: string
  fileId?: string
}

export function FileActions({
  urlPath,
  name,
  verifiedPassword,
  showOcr = false,
  isTextBased = false,
  content,
  fileId,
}: FileActionsProps) {
  const { toast } = useToast()
  const [isOcrDialogOpen, setIsOcrDialogOpen] = useState(false)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [isLoadingOcr, setIsLoadingOcr] = useState(false)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [urls, setUrls] = useState<{ fileUrl: string; rawUrl: string }>()

  const { copyUrl, download, openRaw } = useFileActions({
    urlPath,
    name,
    fileId,
    verifiedPassword,
  })

  // Sanitize a URL
  const sanitizeUrl = (url: string): string => {
    return DOMPurify.sanitize(url)
  }

  // Set up URLs when password changes
  useEffect(() => {
    const passwordParam = verifiedPassword
      ? `?password=${encodeURIComponent(DOMPurify.sanitize(verifiedPassword))}`
      : ''
    const sanitizedUrlPath = DOMPurify.sanitize(urlPath)
    const fileUrl = `/api/files${sanitizedUrlPath}${passwordParam}`
    const rawUrl = `${sanitizedUrlPath}/raw${passwordParam}`
    setUrls({ fileUrl, rawUrl })
  }, [urlPath, verifiedPassword])

  const handleCopyText = async () => {
    if (!urls) return
    try {
      if (content) {
        await navigator.clipboard.writeText(content)
        toast({
          title: 'Text copied',
          description: 'File content has been copied to clipboard',
        })
      } else {
        const response = await fetch(sanitizeUrl(urls.fileUrl))
        const text = await response.text()
        await navigator.clipboard.writeText(text)
        toast({
          title: 'Text copied',
          description: 'File content has been copied to clipboard',
        })
      }
    } catch {
      toast({
        title: 'Failed to copy text',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  const handleOcr = async () => {
    if (!fileId) {
      toast({
        title: 'Error',
        description: 'File ID is required for OCR',
        variant: 'destructive',
      })
      return
    }

    try {
      setIsLoadingOcr(true)
      setOcrError(null)
      console.log('[OCR] Starting OCR request for file:', fileId)
      const sanitizedFileId = DOMPurify.sanitize(fileId)
      const passwordParam = verifiedPassword
        ? `?password=${DOMPurify.sanitize(verifiedPassword)}`
        : ''
      const ocrUrl = `/api/files/${sanitizedFileId}/ocr${passwordParam}`

      const response = await fetch(sanitizeUrl(ocrUrl))
      console.log('[OCR] Response status:', response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error('[OCR] Error response:', errorData)
        throw new Error(errorData.error || 'Failed to process OCR')
      }

      const data = await response.json()
      console.log('[OCR] Response data:', data)

      if (!data.success) {
        console.error('[OCR] OCR processing failed:', data.error)
        setOcrError(data.error || 'There was an error processing the image')
        setOcrText(null)
        setOcrConfidence(null)
      } else {
        console.log('[OCR] OCR processing successful')
        setOcrText(data.text)
        setOcrConfidence(data.confidence)
        setOcrError(null)
      }
      setIsOcrDialogOpen(true)
    } catch (error) {
      console.error('[OCR] Error in handleFetchOcr:', error)
      toast({
        title: 'Failed to fetch OCR text',
        description:
          error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingOcr(false)
    }
  }

  if (!urls) return null

  return (
    <div className="relative">
      {/* Glassmorphic container */}
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        {/* Gradient overlay */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />

        {/* Content */}
        <div className="relative p-6">
          <div className="flex items-center justify-center flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={copyUrl}
              className="backdrop-blur-sm"
            >
              <Link className="h-4 w-4 mr-2" />
              Copy URL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={download}
              className="backdrop-blur-sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openRaw}
              className="backdrop-blur-sm"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Raw
            </Button>
            {showOcr && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleOcr}
                disabled={isLoadingOcr}
                className="backdrop-blur-sm"
              >
                <ScanText className="h-4 w-4 mr-2" />
                Extract Text (OCR)
              </Button>
            )}
            {isTextBased && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyText}
                className="backdrop-blur-sm"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Text
              </Button>
            )}
          </div>
        </div>
      </div>

      <OcrDialog
        isOpen={isOcrDialogOpen}
        onOpenChange={setIsOcrDialogOpen}
        isLoading={isLoadingOcr}
        error={ocrError}
        text={ocrText}
        confidence={ocrConfidence}
      />
    </div>
  )
}
