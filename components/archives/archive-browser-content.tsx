'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronRight,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Lock,
  Search,
  X,
} from 'lucide-react'

import { ImageLightbox } from '@/components/file/image-lightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'

import {
  ARCHIVE_BROWSE_LIMITS,
  type ArchiveEntry,
  type ArchiveFormat,
  type ArchiveListing,
  type ArchiveManifest,
  detectArchiveFormat,
} from '@/lib/archives/shared'
import { cn, formatBytes } from '@/lib/utils'

import { ArchiveEntryPreview } from './archive-entry-preview'
import {
  type ArchiveFileRef,
  type ArchiveLoadUpdate,
  type ArchiveRow,
  type ArchiveSource,
  OWNER_ARCHIVE_SOURCE,
  archiveEntryHref,
  archiveEntryName,
  archiveErrorMessage,
  archiveFetch,
  archiveFolderRows,
  archiveListingRequest,
  archivePreviewKind,
  buildArchiveTree,
  loadArchiveListing,
  searchArchiveRows,
} from './archive-utils'

const ROW_HEIGHT = 44
const UNLOCK_RENEW_MS = 45 * 60_000
const count = (value: number, noun: string) =>
  `${value.toLocaleString()} ${noun}${value === 1 ? '' : 's'}`

type LoadState =
  | { status: 'loading' | 'busy' }
  | {
      status: 'indexing'
      update: Extract<ArchiveLoadUpdate, { status: 'indexing' }>
    }
  | { status: 'ready'; listing: ArchiveListing }
  | { status: 'error'; message: string; retryable: boolean }

function RowIcon({ row }: { row: ArchiveRow }) {
  const className = 'h-4 w-4 shrink-0'
  if (row.type === 'directory')
    return <Folder className={cn(className, 'text-primary')} aria-hidden />
  if (row.issue === 'encrypted')
    return (
      <Lock className={cn(className, 'text-muted-foreground')} aria-hidden />
    )
  if (row.issue === 'link')
    return (
      <Link2 className={cn(className, 'text-muted-foreground')} aria-hidden />
    )
  if (row.issue)
    return (
      <AlertTriangle className={cn(className, 'text-amber-500')} aria-hidden />
    )
  const kind = archivePreviewKind(row.path)?.type
  const Icon = detectArchiveFormat(row.path)
    ? FileArchive
    : kind === 'image'
      ? FileImage
      : kind === 'video'
        ? FileVideo
        : kind === 'audio'
          ? FileAudio
          : kind === 'text'
            ? FileText
            : File
  return <Icon className={cn(className, 'text-muted-foreground')} aria-hidden />
}

function truncationNotice(listing: ArchiveListing) {
  const shown = listing.entries.length.toLocaleString()
  switch (listing.truncated) {
    case 'entries':
      return `Showing the first ${shown} of ${listing.entryCount.toLocaleString()} entries. Download the archive to see everything.`
    case 'time':
      return `Flare stopped reading this archive after ${ARCHIVE_BROWSE_LIMITS.scanMs / 60_000} minutes. Showing the ${shown} entries it found.`
    case 'size':
      return `This archive’s file list is too large to read in full. Showing the first ${shown} entries.`
    case 'damaged':
      return `This archive is damaged or incomplete. Showing the ${shown} entries Flare could read.`
    default:
      return null
  }
}

export function ArchiveBrowserContent({
  file,
  source = OWNER_ARCHIVE_SOURCE,
  format,
  onExtract,
  active = true,
}: {
  file: ArchiveFileRef
  source?: ArchiveSource
  /** Detected from the real name; null means an archive Flare can’t open. */
  format?: ArchiveFormat | null
  onExtract?: (manifest: ArchiveManifest) => void
  active?: boolean
}) {
  const unsupported =
    format === null ||
    (format === undefined &&
      file.mimeType !== undefined &&
      !detectArchiveFormat(file.name, file.mimeType))
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [directory, setDirectory] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ArchiveRow | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const sourceKind = source.kind
  const password = source.kind === 'share' ? source.password : undefined

  useEffect(() => {
    if (unsupported) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    setSelected(null)
    setDirectory('')
    setSearch('')
    loadArchiveListing(
      file.id,
      sourceKind === 'share'
        ? { kind: 'share', password }
        : OWNER_ARCHIVE_SOURCE,
      {
        signal: controller.signal,
        onUpdate: (update) =>
          setState(
            update.status === 'busy'
              ? { status: 'busy' }
              : { status: 'indexing', update }
          ),
      }
    )
      .then((listing) => {
        if (!controller.signal.aborted) setState({ status: 'ready', listing })
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        const status = (cause as { status?: number }).status
        setState({
          status: 'error',
          message: archiveErrorMessage(cause),
          // Damaged or unsupported archives fail the same way every time.
          retryable:
            !status || status === 408 || status === 429 || status >= 500,
        })
      })
    return () => controller.abort()
  }, [file.id, sourceKind, password, attempt, unsupported])

  const listed = state.status === 'ready' ? state.listing.entries.length : null
  useEffect(() => {
    if (sourceKind !== 'share' || !password || listed === null) return
    // Protected previews use a one-hour unlock cookie; renew it while open.
    const timer = setInterval(() => {
      const request = archiveListingRequest(
        file.id,
        { kind: 'share', password },
        { after: listed }
      )
      void archiveFetch(request.url, request.body).catch(() => {})
    }, UNLOCK_RENEW_MS)
    return () => clearInterval(timer)
  }, [file.id, sourceKind, password, listed])

  const entries = useMemo<ArchiveEntry[]>(
    () =>
      state.status === 'ready'
        ? state.listing.entries
        : state.status === 'indexing'
          ? state.update.entries
          : [],
    [state]
  )
  const tree = useMemo(() => buildArchiveTree(entries), [entries])
  const rows = useMemo(
    () =>
      search.trim()
        ? searchArchiveRows(tree, search)
        : archiveFolderRows(tree, directory),
    [tree, directory, search]
  )
  const images = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.type === 'file' &&
          !row.issue &&
          row.position !== undefined &&
          archivePreviewKind(row.path)?.type === 'image'
      ) as (ArchiveRow & { position: number })[],
    [rows]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  useEffect(() => {
    if (focusIndex === null) return
    virtualizer.scrollToIndex(focusIndex, { align: 'auto' })
    const frame = requestAnimationFrame(() =>
      scrollRef.current
        ?.querySelector<HTMLButtonElement>(`[data-row="${focusIndex}"]`)
        ?.focus({ preventScroll: true })
    )
    return () => cancelAnimationFrame(frame)
  }, [focusIndex, virtualizer])

  function openDirectory(path: string) {
    setDirectory(path)
    setSearch('')
    setSelected(null)
    setFocusIndex(null)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function choose(row: ArchiveRow) {
    if (row.type === 'directory') return openDirectory(row.path)
    setSelected(row)
    // On a phone the preview sits below the list; bring it into view.
    requestAnimationFrame(() => {
      const preview = previewRef.current
      if (preview && preview.getBoundingClientRect().top > window.innerHeight)
        preview.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  function moveFocus(event: React.KeyboardEvent) {
    const current = Number(
      (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset
        .row ?? -1
    )
    const last = rows.length - 1
    const next =
      event.key === 'ArrowDown'
        ? Math.min(last, current + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, current - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null || last < 0) return
    event.preventDefault()
    setFocusIndex(next)
  }

  const listing = state.status === 'ready' ? state.listing : null
  const indexing = state.status === 'indexing' ? state.update.progress : null
  const notice = listing && truncationNotice(listing)
  const selectedEntry =
    selected?.position !== undefined
      ? (selected as ArchiveRow & { position: number })
      : null

  if (unsupported)
    return (
      <div className="space-y-3 rounded-xl border border-dashed p-6 text-sm">
        <p className="font-medium">Flare can’t open this kind of archive.</p>
        <p className="leading-relaxed text-muted-foreground">
          ZIP, TAR, TAR.GZ (TGZ), and GZIP archives can be browsed here. RAR and
          7z archives can still be downloaded and opened on your device.
        </p>
      </div>
    )

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {listing
            ? `${listing.format.toUpperCase()} · ${count(listing.fileCount, 'file')} · ${count(tree.folderCount, 'folder')} · ${formatBytes(listing.totalBytes)} unpacked`
            : indexing
              ? `Reading ${indexing.format.toUpperCase()}… ${count(indexing.entriesFound, 'entry').replace('entrys', 'entries')} found`
              : state.status === 'busy'
                ? 'Flare is busy reading other archives. Trying again shortly…'
                : source.kind === 'share'
                  ? 'Loading file and folder details.'
                  : 'Preview entries without adding them to your account.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {source.kind === 'owner' && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/api/files/${encodeURIComponent(file.id)}/download`}
                download={file.name}
              >
                <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
                Download archive
              </a>
            </Button>
          )}
          {source.kind === 'owner' && onExtract && (
            <Button
              size="sm"
              disabled={
                !listing?.entries.length || !listing.extraction.available
              }
              onClick={() => listing && onExtract(listing)}
            >
              <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
              Extract all
            </Button>
          )}
        </div>
      </div>
      {source.kind === 'owner' &&
        onExtract &&
        listing &&
        !listing.extraction.available && (
          <p className="-mt-3 text-xs leading-relaxed text-muted-foreground">
            {listing.extraction.reason}
          </p>
        )}
      {state.status === 'error' ? (
        <div className="space-y-4 rounded-xl border border-destructive/25 bg-destructive/5 p-5">
          <p role="alert" className="break-words text-sm font-medium">
            {state.message}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Flare can browse ZIP, TAR, TAR.GZ (TGZ), and GZIP archives. If this
            file was cut off during upload, upload it again. Otherwise, download
            it to open it on your device.
          </p>
          {state.retryable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </Button>
          )}
        </div>
      ) : !listing && !indexing ? (
        <div
          role="status"
          className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {state.status === 'busy'
            ? 'Waiting to read the archive…'
            : 'Reading archive…'}
        </div>
      ) : (
        <>
          {indexing && (
            <div className="space-y-2" role="status">
              <Progress
                value={
                  indexing.archiveBytes
                    ? (indexing.bytesRead / indexing.archiveBytes) * 100
                    : 0
                }
                aria-label="Archive reading progress"
                className="h-1.5"
              />
              <p className="text-xs text-muted-foreground">
                {indexing.archiveBytes
                  ? `${formatBytes(indexing.bytesRead)} of ${formatBytes(indexing.archiveBytes)} read. You can open files that have already been found.`
                  : 'Waiting to start reading. You can open files as they are found.'}
              </p>
            </div>
          )}
          {notice && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                aria-hidden="true"
              />
              {notice}
            </p>
          )}
          <div className="relative">
            <Search
              className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setFocusIndex(null)
              }}
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
                {count(rows.length, 'search result')} across archive
              </span>
            )}
          </nav>
          <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div
              ref={scrollRef}
              className="max-h-72 min-w-0 overflow-y-auto rounded-xl border md:max-h-[26rem]"
            >
              {rows.length ? (
                <ul
                  aria-label="Archive entries"
                  className="relative w-full"
                  style={{ height: virtualizer.getTotalSize() }}
                  onKeyDown={moveFocus}
                >
                  {virtualizer.getVirtualItems().map((item) => {
                    const row = rows[item.index]
                    const name = archiveEntryName(row.path)
                    const parent = row.path.includes('/')
                      ? row.path.slice(0, row.path.lastIndexOf('/'))
                      : ''
                    const isSelected =
                      row.type === 'file' && selected?.path === row.path
                    return (
                      <li
                        key={`${row.type}:${row.path}`}
                        aria-setsize={rows.length}
                        aria-posinset={item.index + 1}
                        className="absolute left-0 top-0 w-full"
                        style={{
                          height: ROW_HEIGHT,
                          transform: `translateY(${item.start}px)`,
                        }}
                      >
                        <button
                          type="button"
                          data-row={item.index}
                          title={row.path}
                          aria-label={`${row.type === 'directory' ? 'Open folder' : 'Preview'} ${row.path}${row.issue ? ' (unavailable)' : ''}`}
                          aria-pressed={
                            row.type === 'file' ? isSelected : undefined
                          }
                          onClick={() => choose(row)}
                          className={cn(
                            'flex h-full w-full items-center gap-3 px-4 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            item.index < rows.length - 1 && 'border-b',
                            isSelected && 'bg-primary/10',
                            row.issue && 'text-muted-foreground'
                          )}
                        >
                          <RowIcon row={row} />
                          <span className="min-w-0 flex-1 truncate">
                            {name}
                            {search && parent && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {parent}
                              </span>
                            )}
                          </span>
                          {row.type === 'directory' ? (
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          ) : (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatBytes(row.size)}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {search
                    ? 'No entries match your search.'
                    : indexing
                      ? 'Looking for files…'
                      : directory
                        ? 'This folder is empty.'
                        : 'This archive is empty.'}
                </p>
              )}
            </div>
            <div ref={previewRef} className="min-w-0">
              {selectedEntry && active ? (
                <ArchiveEntryPreview
                  key={selectedEntry.path}
                  file={file}
                  source={source}
                  entry={selectedEntry}
                  onExpandImage={() =>
                    setLightbox(
                      Math.max(
                        0,
                        images.findIndex(
                          (image) => image.path === selectedEntry.path
                        )
                      )
                    )
                  }
                />
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <File className="h-7 w-7 opacity-60" aria-hidden="true" />
                  <p>Choose a file to preview or download it.</p>
                  <p className="max-w-xs text-xs leading-relaxed">
                    Images, video, audio, and text open here without extracting
                    the archive.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {lightbox !== null && images[lightbox] && (
        <ImageLightbox
          images={images.map((image) => ({
            id: `${image.position}`,
            name: archiveEntryName(image.path),
            subtitle: image.path,
            src: archiveEntryHref(file.id, source, image.position, {
              inline: true,
            }),
            downloadUrl: archiveEntryHref(file.id, source, image.position),
          }))}
          index={lightbox}
          onIndexChange={(index) => {
            setLightbox(index)
            setSelected(images[index])
          }}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
