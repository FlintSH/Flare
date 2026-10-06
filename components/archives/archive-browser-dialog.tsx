'use client'

import { useState } from 'react'

import { Archive } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { ArchiveManifest } from '@/lib/archives/shared'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'

import { ArchiveBrowserContent } from './archive-browser-content'
import { ArchiveExtractForm } from './archive-extract-form'
import { ARCHIVE_FORM_DIALOG_CLASS, type ArchiveFileRef } from './archive-utils'

export function ArchiveBrowserDialog({
  file,
  onClose,
}: {
  file: ArchiveFileRef
  onClose: () => void
}) {
  const { can } = usePermissions()
  const [extracting, setExtracting] = useState<ArchiveManifest | null>(null)
  const [busy, setBusy] = useState(false)
  const canExtract =
    can('files.read') && can('files.upload') && can('folders.manage')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className={cn(
          'max-h-[calc(100dvh-2rem)] overflow-y-auto',
          extracting
            ? `sm:max-w-lg ${ARCHIVE_FORM_DIALOG_CLASS}`
            : 'sm:max-w-5xl'
        )}
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        {extracting ? (
          <ArchiveExtractForm
            file={file}
            manifest={extracting}
            onBack={() => setExtracting(null)}
            onClose={onClose}
            onBusyChange={setBusy}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-center gap-2 sm:justify-start">
                <Archive className="h-5 w-5 text-primary" aria-hidden="true" />
                Browse archive
              </DialogTitle>
              <DialogDescription className="break-words">
                {file.name}
              </DialogDescription>
            </DialogHeader>
          </>
        )}
        <div className={extracting ? 'hidden' : 'min-w-0'}>
          <ArchiveBrowserContent
            file={file}
            active={!extracting}
            onExtract={canExtract ? setExtracting : undefined}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
