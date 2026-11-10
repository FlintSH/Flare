'use client'

import { Copy, RotateCw } from 'lucide-react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useToast } from '@/hooks/use-toast'

interface OcrDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  error: string | null
  text: string | null
  confidence?: number | null
  filename?: string
  isLoading?: boolean
  /** A neutral status, such as recognition that is still running. */
  notice?: string | null
  /** Shown with errors and notices when another attempt can help. */
  onRetry?: () => void
  /** What the spinner waits for, when that takes more than a moment. */
  loadingText?: string
  /** A line under the text about where it was read. */
  footnote?: string
}

export function OcrDialog({
  isOpen,
  onOpenChange,
  isLoading = false,
  error,
  text,
  confidence,
  filename,
  notice,
  onRetry,
  loadingText,
  footnote,
}: OcrDialogProps) {
  const { toast } = useToast()

  const handleCopy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: 'Copied to clipboard',
        description: 'The extracted text has been copied to your clipboard',
      })
    } catch {
      toast({
        title: 'Couldn’t copy the text',
        description: 'Select the text above and copy it instead.',
        variant: 'destructive',
      })
    }
  }

  const dialogTitle = filename
    ? `Extracted text: ${filename}`
    : 'Extracted text'

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          {/* Room for the close button beside a long file name. */}
          <DialogTitle className="break-words px-6 sm:pl-0">
            {dialogTitle}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {isLoading ? (
            <div
              className="flex flex-col items-center justify-center gap-3 py-8"
              role="status"
            >
              <Icons.spinner className="h-6 w-6 animate-spin" />
              {loadingText && (
                <p className="text-sm text-muted-foreground">{loadingText}</p>
              )}
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger/10 p-4"
              >
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <Icons.alertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
              {onRetry && (
                <Button variant="outline" className="w-full" onClick={onRetry}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Try again
                </Button>
              )}
            </div>
          ) : notice ? (
            <div className="space-y-4">
              <div role="status" className="rounded-xl border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">{notice}</p>
              </div>
              {onRetry && (
                <Button variant="outline" className="w-full" onClick={onRetry}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Check again
                </Button>
              )}
            </div>
          ) : !text ? (
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                No text was found in this image.
              </p>
            </div>
          ) : (
            <div className="relative">
              {confidence !== undefined && confidence !== null && (
                <div className="mb-4 rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">Confidence:</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all duration-500"
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground font-medium">
                      {confidence.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
              <div className="overflow-hidden rounded-xl border bg-muted/30">
                <div className="max-h-[400px] overflow-y-auto p-4">
                  <p className="text-sm whitespace-pre-wrap">{text}</p>
                </div>
              </div>
              <Button className="w-full mt-4" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy text
              </Button>
            </div>
          )}
          {footnote && !isLoading && !error && !notice && (
            <p className="text-pretty text-xs text-muted-foreground">
              {footnote}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
