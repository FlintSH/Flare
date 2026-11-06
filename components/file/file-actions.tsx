'use client'

import { useEffect, useState } from 'react'

import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link,
  Loader2,
  ScanText,
} from 'lucide-react'

import type { FileViewerFile } from '@/components/file/viewer/types'
import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'

import { type FileUrls, fileUrls } from '@/lib/files/urls'
import { cn } from '@/lib/utils'

import { useOcr } from '@/hooks/use-ocr'
import { useToast } from '@/hooks/use-toast'

interface FileActionsProps {
  file: Pick<FileViewerFile, 'id' | 'name' | 'urlPath'>
  verifiedPassword?: string
  showOcr?: boolean
  isTextBased?: boolean
}

export function FileActions({
  file,
  verifiedPassword,
  showOcr = false,
  isTextBased = false,
}: FileActionsProps) {
  const { toast } = useToast()
  const [urls, setUrls] = useState<FileUrls>()
  const ocr = useOcr(urls?.ocr)

  const [copied, setCopied] = useState(false)
  const [isCopyingText, setIsCopyingText] = useState(false)

  // Set once hydrated, so the actions stay disabled until they can run.
  useEffect(() => {
    setUrls(
      fileUrls(
        { id: file.id, urlPath: file.urlPath },
        { password: verifiedPassword }
      )
    )
  }, [file.id, file.urlPath, verifiedPassword])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const download = () => {
    if (!urls) return
    const link = document.createElement('a')
    link.href = urls.download
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const openRaw = () => {
    if (urls) window.open(urls.raw, '_blank')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        fileUrls(file, { origin: window.location.origin }).page
      )
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
      const response = await fetch(urls.content)
      if (!response.ok) throw new Error('Could not load file content')
      await navigator.clipboard.writeText(await response.text())
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
          onClick={() => void ocr.extract()}
          disabled={!urls || ocr.loading}
          className={buttonClassName}
        >
          {ocr.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanText className="h-4 w-4" aria-hidden="true" />
          )}
          {ocr.loading ? 'Reading image…' : 'Extract text'}
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
      <OcrDialog {...ocr.dialog} />
    </div>
  )
}
