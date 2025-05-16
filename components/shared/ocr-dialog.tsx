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
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md flex items-center space-x-2">
              <Icons.alertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : !text ? (
            <p className="text-muted-foreground text-sm">
              No text was found in this image.
            </p>
          ) : (
            <div className="relative">
              {confidence !== undefined && confidence !== null && (
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium">Confidence:</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${confidence}%` }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {confidence.toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="max-h-[400px] overflow-y-auto rounded-md bg-muted p-4">
                <p className="text-sm whitespace-pre-wrap">{text}</p>
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
