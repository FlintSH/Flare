'use client'

import { useEffect, useState } from 'react'

import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link,
  Loader2,
  type LucideIcon,
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
  /**
   * A toolbar beside the file's name, or a stack under it on the small card
   * of a file without a preview.
   */
  layout?: 'toolbar' | 'stack'
}

export function FileActions({
  file,
  verifiedPassword,
  showOcr = false,
  isTextBased = false,
  layout = 'toolbar',
}: FileActionsProps) {
  const { toast } = useToast()
  const [urls, setUrls] = useState<FileUrls>()
  const ocr = useOcr(urls?.ocr)

  const [copied, setCopied] = useState<'link' | 'text'>()
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
    const timeout = window.setTimeout(() => setCopied(undefined), 2500)
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

  const toolbar = layout === 'toolbar'

  // Where the toolbar shows icons without their names (below Tailwind's
  // `lg`), a copied link or text is confirmed in a toast as well: the icon
  // that changes is under the finger that tapped it.
  const confirm = (title: string, description?: string) => {
    if (toolbar && !window.matchMedia('(min-width: 1024px)').matches)
      toast({ title, description })
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        fileUrls(file, { origin: window.location.origin }).page
      )
      setCopied('link')
      confirm('Link copied')
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
      setCopied('text')
      confirm('Text copied', 'File content is ready to paste.')
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

  // In the toolbar the secondary actions are icons until there is room for
  // their names; the name is always the button's accessible name and its
  // tooltip. On the small card they keep their names at every width.
  const secondary = (
    label: string,
    Icon: LucideIcon,
    onClick: () => void,
    options: {
      disabled?: boolean
      /** Announce the name when it changes, as after copying. */
      live?: boolean
      spinning?: boolean
      done?: boolean
      /** More of the name for screen readers only. */
      hint?: string
    } = {}
  ) => (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={!urls || options.disabled}
      title={toolbar ? label : undefined}
      aria-live={options.live ? 'polite' : undefined}
      className={cn(
        'h-9 sm:h-8',
        toolbar ? 'w-9 shrink-0 px-0 sm:w-8 lg:w-auto lg:px-3' : 'w-full'
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4',
          options.spinning && 'animate-spin',
          options.done && 'text-success'
        )}
        aria-hidden="true"
      />
      <span className={cn(toolbar && 'sr-only lg:not-sr-only')}>{label}</span>
      {options.hint && <span className="sr-only">{options.hint}</span>}
    </Button>
  )

  return (
    <div
      className={cn(
        'flex w-full gap-2',
        toolbar ? 'items-center sm:w-auto' : 'flex-col'
      )}
      role="group"
      aria-label="File actions"
    >
      <Button
        size="sm"
        onClick={download}
        disabled={!urls}
        className={cn(
          toolbar ? 'h-9 min-w-0 flex-1 sm:h-8 sm:flex-none' : 'h-10 w-full'
        )}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Download
      </Button>
      <div className={cn(toolbar ? 'contents' : 'grid grid-cols-2 gap-2')}>
        {secondary(
          copied === 'link' ? 'Link copied' : 'Copy link',
          copied === 'link' ? Check : Link,
          () => void handleCopyLink(),
          { live: true, done: copied === 'link' }
        )}
        {isTextBased &&
          secondary(
            isCopyingText
              ? 'Copying…'
              : copied === 'text'
                ? 'Text copied'
                : 'Copy text',
            isCopyingText ? Loader2 : copied === 'text' ? Check : Copy,
            () => void handleCopyText(),
            {
              disabled: isCopyingText,
              live: true,
              spinning: isCopyingText,
              done: copied === 'text',
            }
          )}
        {showOcr &&
          secondary(
            ocr.loading ? 'Reading image…' : 'Extract text',
            ocr.loading ? Loader2 : ScanText,
            () => void ocr.extract(),
            { disabled: ocr.loading, spinning: ocr.loading }
          )}
        {secondary('Open original', ExternalLink, openRaw, {
          hint: ' in a new tab',
        })}
      </div>
      <OcrDialog {...ocr.dialog} />
    </div>
  )
}
