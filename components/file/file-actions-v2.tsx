'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import {
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  Link,
  PlayCircle,
  ScanText,
  Share,
  Volume2,
} from 'lucide-react'

import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { useFileActions } from '@/hooks/use-file-actions'
import { useToast } from '@/hooks/use-toast'

interface FileActionsV2Props {
  urlPath: string
  name: string
  verifiedPassword?: string
  showOcr?: boolean
  isTextBased?: boolean
  content?: string
  fileId?: string
  mimeType: string
}

export function FileActionsV2({
  urlPath,
  name,
  verifiedPassword,
  showOcr = false,
  isTextBased = false,
  content,
  fileId,
  mimeType,
}: FileActionsV2Props) {
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
        const response = await fetch(DOMPurify.sanitize(urls.fileUrl))
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

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: name,
          url: window.location.href,
        })
      } catch (error) {
        // User cancelled sharing
        if ((error as Error).name !== 'AbortError') {
          copyUrl()
        }
      }
    } else {
      copyUrl()
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
      const sanitizedFileId = DOMPurify.sanitize(fileId)
      const passwordParam = verifiedPassword
        ? `?password=${DOMPurify.sanitize(verifiedPassword)}`
        : ''
      const ocrUrl = `/api/files/${sanitizedFileId}/ocr${passwordParam}`

      const response = await fetch(DOMPurify.sanitize(ocrUrl))

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
      setIsOcrDialogOpen(true)
    } catch (error) {
      toast({
        title: 'Failed to extract text',
        description:
          error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingOcr(false)
    }
  }

  const getFileTypeIcon = () => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="h-4 w-4" />
    if (mimeType.startsWith('video/')) return <PlayCircle className="h-4 w-4" />
    if (mimeType.startsWith('audio/')) return <Volume2 className="h-4 w-4" />
    if (isTextBased) return <FileText className="h-4 w-4" />
    return <Eye className="h-4 w-4" />
  }

  if (!urls) return null

  // Primary actions (always visible)
  const primaryActions = [
    {
      icon: <Share className="h-4 w-4" />,
      label: 'Share',
      onClick: handleShare,
    },
    {
      icon: <Download className="h-4 w-4" />,
      label: 'Download',
      onClick: download,
    },
  ]

  // Secondary actions (in overflow menu on mobile)
  const secondaryActions = [
    {
      icon: <Link className="h-4 w-4" />,
      label: 'Copy URL',
      onClick: copyUrl,
    },
    {
      icon: <ExternalLink className="h-4 w-4" />,
      label: 'View Raw',
      onClick: openRaw,
    },
    ...(showOcr
      ? [
          {
            icon: <ScanText className="h-4 w-4" />,
            label: 'Extract Text (OCR)',
            onClick: handleOcr,
            disabled: isLoadingOcr,
          },
        ]
      : []),
    ...(isTextBased
      ? [
          {
            icon: <Copy className="h-4 w-4" />,
            label: 'Copy Text',
            onClick: handleCopyText,
          },
        ]
      : []),
  ]

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {/* Primary actions */}
        <div className="flex gap-2">
          {primaryActions.map((action) => (
            <Button
              key={action.label}
              variant="default"
              size="sm"
              onClick={action.onClick}
              className="flex-1 min-w-0"
            >
              {action.icon}
              <span className="ml-2 hidden sm:inline">{action.label}</span>
            </Button>
          ))}
        </div>

        {/* More actions sheet */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              {getFileTypeIcon()}
              <span className="ml-2 hidden sm:inline">More</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[60vh]">
            <SheetHeader>
              <SheetTitle>File Actions</SheetTitle>
              <SheetDescription>Additional actions for {name}</SheetDescription>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-3 mt-6">
              {secondaryActions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="h-16 flex-col gap-2"
                >
                  {action.icon}
                  <span className="text-xs">{action.label}</span>
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <OcrDialog
        isOpen={isOcrDialogOpen}
        onOpenChange={setIsOcrDialogOpen}
        isLoading={isLoadingOcr}
        error={ocrError}
        text={ocrText}
        confidence={ocrConfidence}
      />
    </>
  )
}
