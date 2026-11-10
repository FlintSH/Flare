'use client'

import { useMemo, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { ArchiveManifest } from '@/lib/archives/shared'
import { normalizedType, safeFileName } from '@/lib/files/safe-render'
import { allows } from '@/lib/permissions/actions'
import { cn } from '@/lib/utils'
import { mbToBytes } from '@/lib/utils/size'

import { useEncryptedFile } from '@/hooks/use-encrypted-file'
import { usePermissions } from '@/hooks/use-permissions'

import { ArchiveBrowserContent } from './archive-browser-content'
import { ArchiveExtractForm } from './archive-extract-form'
import {
  ARCHIVE_FORM_DIALOG_CLASS,
  type ArchiveFileRef,
  type ArchiveSource,
  OWNER_ARCHIVE_SOURCE,
} from './archive-utils'
import { useEncryptedArchive } from './encrypted-archive-handle'

export function ArchiveBrowserDialog({
  file,
  onClose,
}: {
  file: ArchiveFileRef
  onClose: () => void
}) {
  const { user } = usePermissions()
  const [extracting, setExtracting] = useState<ArchiveManifest | null>(null)
  const [busy, setBusy] = useState(false)
  const canExtract = allows(user, 'extractArchive')
  // An encrypted archive is read in this browser, with the key the account
  // key opened (docs/e2ee-spec.md, section 12.3).
  const encryption = useEncryptedFile(file)
  const opened = encryption?.status === 'open' ? encryption.opened : null
  const header = file.encryption?.header
  const archiveFile = useMemo(
    () =>
      opened && header && file.urlPath
        ? {
            id: file.id,
            urlPath: file.urlPath,
            header,
            sizeBytes:
              file.size === undefined
                ? undefined
                : Math.round(mbToBytes(file.size)),
            opened,
          }
        : null,
    [file.id, file.urlPath, file.size, header, opened]
  )
  const handle = useEncryptedArchive(archiveFile)
  const source = useMemo<ArchiveSource | null>(
    () =>
      !file.encrypted
        ? OWNER_ARCHIVE_SOURCE
        : handle
          ? { kind: 'encrypted', archive: handle, owner: true }
          : null,
    [file.encrypted, handle]
  )
  const shown = opened
    ? {
        ...file,
        name: safeFileName(opened.name),
        mimeType: normalizedType(opened.type),
      }
    : file
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
            file={shown}
            archive={handle}
            manifest={extracting}
            onBack={() => setExtracting(null)}
            onClose={onClose}
            onBusyChange={setBusy}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Browse archive</DialogTitle>
              <DialogDescription className="break-words">
                Contents of{' '}
                <span className="font-medium text-foreground">
                  {shown.name}
                </span>
                .
              </DialogDescription>
            </DialogHeader>
          </>
        )}
        <div className={extracting ? 'hidden' : 'min-w-0'}>
          {source ? (
            <ArchiveBrowserContent
              file={shown}
              source={source}
              active={!extracting}
              onExtract={canExtract ? setExtracting : undefined}
            />
          ) : (
            <p
              role="status"
              className="flex min-h-56 items-center justify-center text-sm text-muted-foreground"
            >
              {encryption?.status === 'locked'
                ? 'Unlock your encryption keys to browse this archive.'
                : encryption?.status === 'failed'
                  ? 'Your keys do not open this file.'
                  : 'Decrypting…'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
