'use client'

import { useState } from 'react'

import {
  Copy,
  Download,
  ExternalLink,
  Link,
  MoreHorizontal,
  QrCode,
  ScanText,
  Share2,
} from 'lucide-react'

import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

import { useFileActions } from '@/hooks/use-file-actions'
import { useToast } from '@/hooks/use-toast'

interface FileActionsV2Props {
  urlPath: string
  name: string
  fileId: string
  mimeType: string
  verifiedPassword?: string
}

export function FileActionsV2({
  urlPath,
  name,
  fileId,
  mimeType,
  verifiedPassword,
}: FileActionsV2Props) {
  const { toast } = useToast()
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [isOcrDialogOpen, setIsOcrDialogOpen] = useState(false)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [isLoadingOcr, setIsLoadingOcr] = useState(false)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)

  const { copyUrl, download, openRaw } = useFileActions({
    urlPath,
    name,
    fileId,
    verifiedPassword,
  })

  const isImage = mimeType.startsWith('image/')
  const currentUrl = typeof window !== 'undefined' ? window.location.href : ''

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: name,
          url: currentUrl,
        })
      } catch {
        // User cancelled sharing
      }
    } else {
      setShowShareDialog(true)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl)
      toast({
        title: 'Link copied',
        description: 'File link has been copied to clipboard',
      })
      setShowShareDialog(false)
    } catch {
      toast({
        title: 'Failed to copy link',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  const handleOcr = async () => {
    try {
      setIsLoadingOcr(true)
      setOcrError(null)

      const passwordParam = verifiedPassword
        ? `?password=${verifiedPassword}`
        : ''
      const ocrUrl = `/api/files/${fileId}/ocr${passwordParam}`

      const response = await fetch(ocrUrl)

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

  const generateQRCode = (url: string) => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`
  }

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* Primary Actions - Always Visible */}
          <Button
            onClick={download}
            className="flex-1 min-w-[120px] sm:flex-none"
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>

          <Button
            onClick={copyUrl}
            variant="outline"
            className="flex-1 min-w-[120px] sm:flex-none"
          >
            <Link className="h-4 w-4 mr-2" />
            Copy Link
          </Button>

          <Button
            onClick={openRaw}
            variant="outline"
            className="hidden sm:flex"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Raw View
          </Button>

          {/* Secondary Actions */}
          <div className="flex gap-2">
            <Button onClick={handleShare} variant="outline" size="sm">
              <Share2 className="h-4 w-4" />
              <span className="sr-only">Share</span>
            </Button>

            {isImage && (
              <Button
                onClick={handleOcr}
                variant="outline"
                size="sm"
                disabled={isLoadingOcr}
              >
                <ScanText className="h-4 w-4" />
                <span className="sr-only">Extract Text</span>
              </Button>
            )}

            {/* More Actions Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openRaw} className="sm:hidden">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Raw View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowQRCode(true)}>
                  <QrCode className="h-4 w-4 mr-2" />
                  QR Code
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    window.open(
                      `https://www.google.com/search?q=${encodeURIComponent(name)}`,
                      '_blank'
                    )
                  }
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Search Online
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Card>

      {/* Share Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Input value={currentUrl} readOnly />
              <Button onClick={handleCopyLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Copy the link to share this file with others
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center space-y-4">
            <img
              src={generateQRCode(currentUrl)}
              alt="QR Code"
              className="border rounded-lg"
            />
            <p className="text-sm text-muted-foreground text-center">
              Scan this QR code to open the file on another device
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* OCR Dialog */}
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
