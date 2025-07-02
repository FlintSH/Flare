'use client'

import { Copy } from 'lucide-react'

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
}

export function OcrDialog({
  isOpen,
  onOpenChange,
  isLoading = false,
  error,
  text,
  confidence,
  filename,
}: OcrDialogProps) {
  const { toast } = useToast()

  const handleCopy = async () => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    toast({
      title: 'Copied to clipboard',
      description: 'The extracted text has been copied to your clipboard',
    })
  }

  const dialogTitle = filename
    ? `Extracted Text - ${filename}`
    : 'Extracted Text'

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Icons.spinner className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="relative rounded-xl bg-destructive/10 border border-destructive/20 backdrop-blur-sm p-4">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-destructive/5 via-transparent to-destructive/10" />
              <div className="relative text-sm text-destructive flex items-center space-x-2">
                <Icons.alertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          ) : !text ? (
            <div className="relative rounded-xl bg-white/5 dark:bg-black/5 border border-white/10 dark:border-white/5 backdrop-blur-sm p-4">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
              <p className="relative text-muted-foreground text-sm">
                No text was found in this image.
              </p>
            </div>
          ) : (
            <div className="relative">
              {confidence !== undefined && confidence !== null && (
                <div className="mb-4 relative rounded-xl bg-white/5 dark:bg-black/5 border border-white/10 dark:border-white/5 backdrop-blur-sm p-4">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
                  <div className="relative flex items-center gap-3">
                    <span className="text-sm font-medium">Confidence:</span>
                    <div className="flex-1 h-2 bg-white/10 dark:bg-black/10 rounded-full overflow-hidden backdrop-blur-sm border border-white/20 dark:border-white/10">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-500"
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground font-medium">
                      {confidence.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
              <div className="relative rounded-xl bg-white/5 dark:bg-black/5 border border-white/10 dark:border-white/5 backdrop-blur-sm overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
                <div className="relative max-h-[400px] overflow-y-auto p-4">
                  <p className="text-sm whitespace-pre-wrap">{text}</p>
                </div>
              </div>
              <Button className="w-full mt-4" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Text
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
