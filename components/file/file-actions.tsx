'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import { Copy, Download, ExternalLink, Link, ScanText } from 'lucide-react'

import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'

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

  const handleCopyUrl = () => {
    if (!urls) return
    const sanitizedUrl = DOMPurify.sanitize(window.location.origin + urlPath)
    navigator.clipboard.writeText(sanitizedUrl)
    toast({
      title: 'URL copied',
      description: 'File URL has been copied to clipboard',
    })
  }

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
    <div className="flex items-center justify-center flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={handleCopyUrl}>
        <Link className="h-4 w-4 mr-2" />
        Copy URL
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a
          href={`${sanitizeUrl(urls.fileUrl)}${verifiedPassword ? '&' : '?'}download=true`}
          download={DOMPurify.sanitize(name)}
        >
          <Download className="h-4 w-4 mr-2" />
          Download
        </a>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <a
          href={sanitizeUrl(urls.rawUrl)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Raw
        </a>
      </Button>
      {showOcr && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleOcr}
          disabled={isLoadingOcr}
        >
          <ScanText className="h-4 w-4 mr-2" />
          Extract Text (OCR)
        </Button>
      )}
      {isTextBased && (
        <Button variant="outline" size="sm" onClick={handleCopyText}>
          <Copy className="h-4 w-4 mr-2" />
          Copy Text
        </Button>
      )}

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
