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

import {
  OcrDialog,
  type OcrDialogState,
  ocrDialogState,
  requestOcr,
} from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'

import { cn } from '@/lib/utils'

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
  const [ocrNotice, setOcrNotice] = useState<string | null>(null)
  const [canRetryOcr, setCanRetryOcr] = useState(false)
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

  const applyOcrState = (state: OcrDialogState) => {
    setOcrText(state.text)
    setOcrConfidence(state.confidence)
    setOcrNotice(state.notice)
    setOcrError(state.error)
    setCanRetryOcr(state.canRetry)
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
      setOcrNotice(null)
      setIsOcrDialogOpen(true)
      const sanitizedFileId = DOMPurify.sanitize(fileId)
      const passwordParam = verifiedPassword
        ? `?password=${encodeURIComponent(verifiedPassword)}`
        : ''
      const ocrUrl = `/api/files/${sanitizedFileId}/ocr${passwordParam}`

      applyOcrState(ocrDialogState(await requestOcr(sanitizeUrl(ocrUrl))))
    } catch {
      applyOcrState(ocrDialogState(null))
    } finally {
      setIsLoadingOcr(false)
    }
  }

  // Phones get an even two-column grid; an odd count gives Download a row.
  // The grid asks for the screen's width so a card sized to its content
  // still spans the phone.
  const actionCount = 3 + Number(isTextBased) + Number(showOcr)
  // The app's one button shape; taller touch targets on phones.
  const buttonClassName = 'h-9 w-full sm:h-8 sm:w-auto'

  return (
    <div
      className="grid w-screen max-w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center"
      role="group"
      aria-label="File actions"
    >
      <Button
        size="sm"
        onClick={download}
        disabled={!urls}
        className={cn(buttonClassName, actionCount % 2 === 1 && 'col-span-2')}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Download
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopyLink}
        disabled={!urls}
        className={buttonClassName}
        aria-live="polite"
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Link className="h-4 w-4" aria-hidden="true" />
        )}
        {copied ? 'Link copied' : 'Copy link'}
      </Button>
      {isTextBased && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyText}
          disabled={!urls || isCopyingText}
          className={buttonClassName}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          {isCopyingText ? 'Copying…' : 'Copy text'}
        </Button>
      )}
      {showOcr && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleOcr}
          disabled={!urls || isLoadingOcr}
          className={buttonClassName}
        >
          {isLoadingOcr ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanText className="h-4 w-4" aria-hidden="true" />
          )}
          {isLoadingOcr ? 'Reading image…' : 'Extract text'}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={openRaw}
        disabled={!urls}
        className={buttonClassName}
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        Open original<span className="sr-only"> in a new tab</span>
      </Button>
      <OcrDialog
        isOpen={isOcrDialogOpen}
        onOpenChange={setIsOcrDialogOpen}
        isLoading={isLoadingOcr}
        error={ocrError}
        notice={ocrNotice}
        onRetry={canRetryOcr ? () => void handleOcr() : undefined}
        text={ocrText}
        confidence={ocrConfidence}
      />
    </div>
  )
}
