'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Archive,
  ArrowDownToLine,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import type { ArchiveEntry, ArchiveManifest } from '@/lib/archives/shared'
import { cn, formatBytes } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'

import { ArchiveExtractForm } from './archive-extract-form'
import {
  ARCHIVE_FORM_DIALOG_CLASS,
  type ArchiveFileRef,
  IMAGE_PREVIEW_BYTES,
  TEXT_PREVIEW_BYTES,
  archiveEntriesAt,
  archiveEntryName,
  archiveEntryUrl,
  archiveErrorMessage,
  archiveFolderCount,
  archivePreviewKind,
  archiveRequest,
  isSafeArchiveImage,
  readPreviewBytes,
} from './archive-utils'

function ArchiveEntryPreview({
  file,
  entry,
}: {
  file: ArchiveFileRef
  entry: ArchiveEntry
}) {
  const [preview, setPreview] = useState<{
    text?: string
    image?: string
    truncated?: boolean
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const kind = archivePreviewKind(entry.path)
  const tooLarge = kind?.type === 'image' && entry.size > IMAGE_PREVIEW_BYTES
  const previewType = kind?.type

  useEffect(() => {
    if (!previewType || tooLarge) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    setLoading(true)
    setError('')
    setPreview(null)
    async function load() {
      try {
        const response = await fetch(archiveEntryUrl(file.id, entry.path), {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          const result = await response.json().catch(() => ({}))
          throw new Error(
            result.error || 'This entry could not be loaded. Please try again.'
          )
        }
        const mimeType = response.headers.get('Content-Type') || ''
        if (previewType === 'image' && !isSafeArchiveImage(mimeType)) {
          await response.body?.cancel()
          throw new Error(
            'This entry is not a verified image. Download it to view its contents.'
          )
        }
        const { bytes, truncated } = await readPreviewBytes(
          response,
          previewType === 'image' ? IMAGE_PREVIEW_BYTES : TEXT_PREVIEW_BYTES
        )
        if (controller.signal.aborted) return
        if (previewType === 'image') {
          if (truncated)
            throw new Error(
              'Images larger than 10 MiB are available to download without a preview.'
            )
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
          setPreview({ image: objectUrl })
        } else {
          setPreview({ text: new TextDecoder().decode(bytes), truncated })
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(archiveErrorMessage(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, entry.path, previewType, tooLarge, attempt])

  return (
    <section
      className="flex min-w-0 flex-col rounded-xl border bg-muted/10"
      aria-label="Entry preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium">{entry.path}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(entry.size)} · Preview only
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a
            href={archiveEntryUrl(file.id, entry.path)}
            download={archiveEntryName(entry.path)}
          >
            <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
            Download entry
          </a>
        </Button>
      </div>
      <div className="min-h-40 min-w-0 p-4">
        {loading && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading preview…
          </p>
        )}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry preview
            </Button>
          </div>
        )}
        {!kind && (
          <p className="text-sm text-muted-foreground">
            Preview not available for this file type. Download the entry to open
            it on your device.
          </p>
        )}
        {tooLarge && (
          <p className="text-sm text-muted-foreground">
            Images larger than 10 MiB are available to download without a
            preview.
          </p>
        )}
        {preview?.image && (
          // The server verifies a raster signature; URLs are local, bounded and revoked on unmount.
          <img
            src={preview.image}
            alt={`Preview of ${entry.path}`}
            className="mx-auto max-h-80 max-w-full rounded-lg object-contain"
            onError={() => {
              setPreview(null)
              setError(
                'Your browser could not display this image. Download the entry to open it.'
              )
            }}
          />
        )}
        {preview?.text !== undefined && (
          <>
            <pre
              className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed"
              aria-label="Entry text"
            >
              {preview.text || '(Empty file)'}
            </pre>
            {preview.truncated && (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the first 256 KiB. Download the entry for the complete
                file.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export function ArchiveBrowserDialog({
  file,
  onClose,
}: {
  file: ArchiveFileRef
  onClose: () => void
}) {
  const { can } = usePermissions()
  const [manifest, setManifest] = useState<ArchiveManifest | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [directory, setDirectory] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ArchiveEntry | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [busy, setBusy] = useState(false)
  const entries = useMemo(
    () => archiveEntriesAt(manifest?.entries || [], directory, search),
    [manifest, directory, search]
  )

  useEffect(() => {
    const controller = new AbortController()
    setManifest(null)
    setError('')
    void archiveRequest<ArchiveManifest>(
      `/api/files/${encodeURIComponent(file.id)}/archive`,
      undefined,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) setManifest(result)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(archiveErrorMessage(cause))
      })
    return () => controller.abort()
  }, [file.id, attempt])

  function openDirectory(path: string) {
    setDirectory(path)
    setSearch('')
    setSelected(null)
  }

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
        {extracting && manifest ? (
          <ArchiveExtractForm
            file={file}
            manifest={manifest}
            onBack={() => setExtracting(false)}
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {manifest
                  ? `${manifest.format.toUpperCase()} · ${manifest.fileCount} ${manifest.fileCount === 1 ? 'file' : 'files'} · ${archiveFolderCount(manifest.entries)} ${archiveFolderCount(manifest.entries) === 1 ? 'folder' : 'folders'} · ${formatBytes(manifest.totalBytes)} unpacked`
                  : 'Preview entries without adding them to your account.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`/api/files/${encodeURIComponent(file.id)}/download`}
                    download={file.name}
                  >
                    <ArrowDownToLine
                      className="mr-2 h-4 w-4"
                      aria-hidden="true"
                    />
                    Download archive
                  </a>
                </Button>
                {can('files.read') &&
                  can('files.upload') &&
                  can('folders.manage') && (
                    <Button
                      size="sm"
                      disabled={!manifest?.entries.length}
                      onClick={() => setExtracting(true)}
                    >
                      <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
                      Extract all
                    </Button>
                  )}
              </div>
            </div>
            {error ? (
              <div className="space-y-4 rounded-xl border border-destructive/25 bg-destructive/5 p-5">
                <p role="alert" className="break-words text-sm font-medium">
                  {error}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Supported formats are ZIP, TAR, TAR.GZ (TGZ), and GZIP. RAR,
                  7z, encrypted archives, and unsafe entries cannot be opened
                  here. An archive’s encryption password is separate from
                  Flare’s file password; upload an unencrypted copy to browse
                  it.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : !manifest ? (
              <div
                role="status"
                className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground"
              >
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                Reading archive…
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search
                    className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search archive"
                    placeholder="Search files and folders in this archive"
                    className="pl-9 pr-10"
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label="Clear archive search"
                      onClick={() => setSearch('')}
                      className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <nav
                  aria-label="Archive location"
                  className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground"
                >
                  <button
                    type="button"
                    className="rounded px-1 py-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openDirectory('')}
                  >
                    Archive root
                  </button>
                  {directory
                    .split('/')
                    .filter(Boolean)
                    .map((name, index, parts) => (
                      <span
                        key={index}
                        className="inline-flex min-w-0 items-center gap-1"
                      >
                        <ChevronRight
                          className="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className="min-w-0 break-words rounded px-1 py-1 text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            openDirectory(parts.slice(0, index + 1).join('/'))
                          }
                        >
                          {name}
                        </button>
                      </span>
                    ))}
                  {search && (
                    <span className="ml-auto py-1">
                      {entries.length} search{' '}
                      {entries.length === 1 ? 'result' : 'results'} across
                      archive
                    </span>
                  )}
                </nav>
                <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <div className="max-h-72 min-w-0 overflow-y-auto rounded-xl border md:max-h-[26rem]">
                    {entries.length ? (
                      <ul aria-label="Archive entries" className="divide-y">
                        {entries.map((entry) => (
                          <li key={entry.path}>
                            <button
                              type="button"
                              aria-label={`${entry.type === 'directory' ? 'Open folder' : 'Preview'} ${entry.path}`}
                              aria-pressed={
                                entry.type === 'file'
                                  ? selected?.path === entry.path
                                  : undefined
                              }
                              onClick={() =>
                                entry.type === 'directory'
                                  ? openDirectory(entry.path)
                                  : setSelected(entry)
                              }
                              className={cn(
                                'flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                                selected?.path === entry.path && 'bg-primary/10'
                              )}
                            >
                              {entry.type === 'directory' ? (
                                <Folder
                                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                                  aria-hidden="true"
                                />
                              ) : (
                                <File
                                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="min-w-0 flex-1 break-words">
                                {search
                                  ? entry.path
                                  : archiveEntryName(entry.path)}
                              </span>
                              {entry.type === 'directory' ? (
                                <ChevronRight
                                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              ) : (
                                <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                                  {formatBytes(entry.size)}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="p-6 text-center text-sm text-muted-foreground">
                        {search
                          ? 'No entries match your search.'
                          : directory
                            ? 'This folder is empty.'
                            : 'This archive is empty.'}
                      </p>
                    )}
                  </div>
                  {selected ? (
                    <ArchiveEntryPreview
                      key={selected.path}
                      file={file}
                      entry={selected}
                    />
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      <File className="h-7 w-7 opacity-60" aria-hidden="true" />
                      <p>Choose a file to preview or download it.</p>
                      <p className="max-w-xs text-xs leading-relaxed">
                        Text previews show up to 256 KiB. Verified images up to
                        10 MiB can be previewed here.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
