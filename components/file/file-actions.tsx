'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link,
  Loader2,
  ScanText,
} from 'lucide-react'

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

  const [copied, setCopied] = useState(false)
  const [isCopyingText, setIsCopyingText] = useState(false)

  const { download, openRaw } = useFileActions({
    urlPath,
    name,
    fileId,
    verifiedPassword,
  })

  const sanitizeUrl = (url: string): string => {
    return DOMPurify.sanitize(url)
  }

  useEffect(() => {
    const passwordParam = verifiedPassword
      ? `?password=${encodeURIComponent(verifiedPassword)}`
      : ''
    const sanitizedUrlPath = DOMPurify.sanitize(urlPath)
    const fileUrl = `/api/files${sanitizedUrlPath}${passwordParam}`
    const rawUrl = `${sanitizedUrlPath}/raw${passwordParam}`
    setUrls({ fileUrl, rawUrl })
  }, [urlPath, verifiedPassword])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${urlPath}`)
      setCopied(true)
    } catch {
      toast({
        title: 'Couldn’t copy the link',
        description: 'Copy the address from your browser instead.',
        variant: 'destructive',
      })
    }
  }

  const handleCopyText = async () => {
    if (!urls) return
    setIsCopyingText(true)
    try {
      let text = content
      if (text === undefined) {
        const response = await fetch(sanitizeUrl(urls.fileUrl))
        if (!response.ok) throw new Error('Could not load file content')
        text = await response.text()
      }
      await navigator.clipboard.writeText(text)
      toast({
        title: 'Text copied',
        description: 'File content is ready to paste.',
      })
    } catch {
      toast({
        title: 'Couldn’t copy the text',
        description: 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsCopyingText(false)
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
      setIsOcrDialogOpen(true)
      const sanitizedFileId = DOMPurify.sanitize(fileId)
      const passwordParam = verifiedPassword
        ? `?password=${encodeURIComponent(verifiedPassword)}`
        : ''
      const ocrUrl = `/api/files/${sanitizedFileId}/ocr${passwordParam}`

      const response = await fetch(sanitizeUrl(ocrUrl))

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to process OCR')
      }

      const data = await response.json()

      if (!data.success) {
        setOcrError(data.error || 'There was an error processing the image')
        setOcrText(null)
        setOcrConfidence(null)
      } else {
        setOcrText(data.text)
        setOcrConfidence(data.confidence)
        setOcrError(null)
      }
    } catch (error) {
      setOcrError(
        error instanceof Error
          ? error.message
          : 'Couldn’t extract text. Please try again.'
      )
      setOcrText(null)
      setOcrConfidence(null)
    } finally {
      setIsLoadingOcr(false)
    }
  }

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2"
      role="group"
      aria-label="File actions"
    >
      <Button
        size="sm"
        onClick={download}
        disabled={!urls}
        className="rounded-lg"
      >
        <Download className="mr-2 h-4 w-4" aria-hidden="true" />
        Download
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopyLink}
        disabled={!urls}
        className="rounded-lg"
        aria-live="polite"
      >
        {copied ? (
          <Check className="mr-2 h-4 w-4" aria-hidden="true" />
        ) : (
          <Link className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {copied ? 'Link copied' : 'Copy link'}
      </Button>
      {isTextBased && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyText}
          disabled={!urls || isCopyingText}
          className="rounded-lg"
        >
          <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
          {isCopyingText ? 'Copying…' : 'Copy text'}
        </Button>
      )}
      {showOcr && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleOcr}
          disabled={!urls || isLoadingOcr}
          className="rounded-lg"
        >
          {isLoadingOcr ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanText className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {isLoadingOcr ? 'Reading image…' : 'Extract text'}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={openRaw}
        disabled={!urls}
        className="rounded-lg text-muted-foreground"
      >
        <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
        Open original<span className="sr-only"> in a new tab</span>
      </Button>
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
