'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  File as FileIcon,
  Folder,
  Loader2,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { apiRequest } from '@/lib/client/request'
import { folderDestination, libraryHref } from '@/lib/library/contract'
import type { UploadResponse } from '@/lib/uploads/client'
import { namePastedFile, pasteBelongsElsewhere } from '@/lib/uploads/clipboard'
import type { QueuedFile } from '@/lib/uploads/queue'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'
import { formatTransfer } from '@/lib/uploads/speed'
import { cn, formatBytes } from '@/lib/utils'

import { useHydrated } from '@/hooks/use-hydrated'
import { useToast } from '@/hooks/use-toast'
import { copyUploadLinks, useUploadQueue } from '@/hooks/use-upload-queue'

import { UploadOptionsBar } from './options-bar'
import { UploadTips, type UploadTipsShown } from './upload-tips'
import { useUploadOptions } from './use-upload-options'

type Finished = {
  key: string
  name: string
  size: number
  /** An object URL for an image, revoked when the row goes. */
  preview?: string
  link: string
}

const link = (file: UploadResponse) => file.pageUrl || file.url

/** The link without its scheme, as people read it. */
const readable = (url: string) => url.replace(/^https?:\/\//, '')

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

/**
 * The Upload page: choose or paste files, see what they'll be uploaded as,
 * and leave with their links. Every file stays in one list, from queued to
 * sent, with its link or why it failed.
 */
export function UploadForm({
  maxSize,
  saved,
  folder,
  tips: initialTips = null,
}: {
  maxSize: number
  saved: SavedUploadSettings
  /** The folder a link to Upload names, when it is the account's. */
  folder?: { id: string; name: string } | null
  /** The tips to show while nothing is listed, unless the account hid them. */
  tips?: UploadTipsShown | null
}) {
  const hydrated = useHydrated()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const searchParams = useSearchParams()
  const requested = folderDestination(searchParams.get('folder'))
  const options = useUploadOptions(
    saved,
    requested
      ? {
          id: requested,
          name: folder?.id === requested ? folder.name : undefined,
        }
      : null
  )
  // This page shows each outcome in its list; a notification is only for
  // someone who left before the batch ended.
  const queue = useUploadQueue({ quiet: () => mounted.current })
  const { files: queued, uploading } = queue
  const [finished, setFinished] = useState<Finished[]>([])
  const [failure, setFailure] = useState<{ key: number; reason: string }>()
  const [refused, setRefused] = useState(0)
  const [batchFolder, setBatchFolder] = useState<{
    id: string
    name: string
  }>()
  const [copied, setCopied] = useState<string>()
  // As a batch ends, the queue lets go of its files a moment before their
  // links arrive. Keep showing them for that moment so the page doesn't jump.
  const [ending, setEnding] = useState<readonly QueuedFile[] | null>(null)
  const rows = queued.length || !ending ? queued : ending
  const { toast } = useToast()
  const [tips, setTips] = useState(initialTips)

  // Previews of finished files are this page's, so release them with it.
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const urls = previews.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])
  const release = (rows: readonly Finished[]) => {
    for (const { preview } of rows)
      if (preview) {
        URL.revokeObjectURL(preview)
        previews.current.delete(preview)
      }
  }

  const add = useCallback(
    (selected: readonly File[]) => {
      if (!selected.length) return
      setRefused(queue.add(selected, maxSize).length)
    },
    [queue, maxSize]
  )

  const { getRootProps, getInputProps, isDragActive, rootRef } = useDropzone({
    onDrop: add,
    disabled: uploading,
  })

  // Ctrl/⌘+V anywhere on the page adds copied files and screenshots.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (uploading || pasteBelongsElsewhere(event.target)) return
      const pasted = Array.from(event.clipboardData?.files ?? [])
      if (!pasted.length) return
      event.preventDefault()
      const now = new Date()
      add(pasted.map((file) => namePastedFile(file, now)))
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [add, uploading])

  const send = async () => {
    const batch = [...queued]
    const folder = options.folders.selected
    setFailure(undefined)
    setEnding(batch)
    const result = await queue.upload(options.options)
    setEnding(null)
    if (!result) return
    const done = result.uploaded.map((file, index): Finished => {
      const source = batch[index]
      // Someone who left meanwhile gets a notification, not this list.
      const preview =
        mounted.current && source?.file.type.startsWith('image/')
          ? URL.createObjectURL(source.file)
          : undefined
      if (preview) previews.current.add(preview)
      return {
        key: `${source?.key ?? index}-${link(file)}`,
        name: file.name,
        size: file.size,
        preview,
        link: link(file),
      }
    })
    setFinished((previous) => [...done, ...previous])
    if (done.length && folder)
      setBatchFolder({ id: folder.id, name: folder.name })
    const failed = batch[result.uploaded.length]
    if (result.failure && failed)
      setFailure({ key: failed.key, reason: result.failure.reason })
  }

  const copy = async (value: string) => {
    if (await copyUploadLinks(value)) {
      setCopied(value)
      setTimeout(
        () => setCopied((current) => (current === value ? undefined : current)),
        2000
      )
    }
  }

  // Hidden at once and for good. If that can't be saved, the tips come back
  // rather than return unannounced on the next visit.
  const hideTips = async () => {
    const shown = tips
    setTips(null)
    rootRef.current?.focus()
    try {
      await apiRequest('/api/profile/tips', {
        method: 'POST',
        body: { hide: 'upload' },
        fallback: 'Your choice could not be saved.',
      })
    } catch (failure) {
      if (!mounted.current) return
      setTips(shown)
      toast({
        variant: 'destructive',
        title: 'Couldn’t hide the tips',
        description:
          failure instanceof Error ? failure.message : 'Please try again.',
      })
    }
  }

  const clear = () => {
    release(finished)
    setFinished([])
    setFailure(undefined)
    setBatchFolder(undefined)
    queue.clear()
  }

  const totalBytes = queued.reduce((sum, { file }) => sum + file.size, 0)
  const hasRows = rows.length > 0 || finished.length > 0
  const limit = `Up to ${formatBytes(maxSize)} each`
  const pasteKey =
    hydrated && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V'
  const blocked =
    !queued.length || uploading || !!options.problem || options.pending

  return (
    <div className="space-y-4">
      <div
        {...getRootProps({
          role: 'button',
          'aria-label': 'Choose files to upload',
          'aria-disabled': uploading,
          className: cn(
            'cursor-pointer rounded-xl border-2 border-dashed border-control bg-muted/20 outline-none transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isDragActive && 'border-primary bg-primary/5',
            uploading && 'pointer-events-none opacity-60'
          ),
        })}
      >
        <input {...getInputProps()} />
        {!hasRows ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center sm:py-14">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Upload className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-balance text-base font-medium">
              {isDragActive ? (
                'Drop to add them'
              ) : (
                <>
                  <span className="[@media(pointer:coarse)]:hidden">
                    Drop files here or{' '}
                    <span className="text-primary">choose files</span>
                  </span>
                  <span className="hidden [@media(pointer:coarse)]:inline">
                    Choose files
                  </span>
                </>
              )}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {limit}
              <span className="[@media(pointer:coarse)]:hidden">
                {' '}
                · paste with {pasteKey}
              </span>
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm">
            <Plus
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-medium">
              {isDragActive ? 'Drop to add them' : 'Add more files'}
            </span>
            <span className="text-muted-foreground [@media(pointer:coarse)]:hidden">
              or drop them here
            </span>
          </div>
        )}
      </div>

      {refused > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {refused === 1
            ? `One file is larger than ${formatBytes(maxSize)} and wasn’t added.`
            : `${refused} files are larger than ${formatBytes(maxSize)} and weren’t added.`}
        </p>
      )}

      <UploadOptionsBar
        state={options}
        disabled={uploading}
        passwordId="upload-password"
      >
        <Button onClick={() => void send()} disabled={blocked}>
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="h-4 w-4" aria-hidden="true" />
          )}
          {uploading
            ? 'Uploading…'
            : !queued.length
              ? 'Upload'
              : failure
                ? `Retry ${files(queued.length)}`
                : `Upload ${files(queued.length)}`}
        </Button>
      </UploadOptionsBar>

      {!hasRows && tips && (
        <UploadTips shown={tips} onHide={() => void hideTips()} />
      )}

      {hasRows && (
        <section
          aria-labelledby="upload-list-heading"
          className="space-y-2 pt-2"
        >
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2
              id="upload-list-heading"
              className="text-sm text-muted-foreground"
              aria-live="polite"
            >
              {[
                queued.length
                  ? `${files(queued.length)} · ${formatBytes(totalBytes)}`
                  : null,
                finished.length ? `${finished.length} uploaded` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </h2>
            <div className="flex items-center gap-1">
              {batchFolder && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={libraryHref({ folder: batchFolder.id })}>
                    <Folder className="h-4 w-4" aria-hidden="true" />
                    Open {batchFolder.name}
                  </Link>
                </Button>
              )}
              {finished.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void copy(finished.map((row) => row.link).join('\n'))
                  }
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy all links
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                disabled={uploading}
              >
                Clear
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border">
            {rows.map(({ key, file, preview, uploaded, progress, speed }) => {
              const sending = uploading && (progress > 0 || uploaded > 0)
              const reason = failure?.key === key ? failure.reason : null
              return (
                <li key={key} className="flex items-center gap-3 p-3">
                  <Thumb preview={preview} />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    {reason ? (
                      <p className="mt-0.5 flex items-start gap-1.5 text-xs text-destructive">
                        <AlertCircle
                          className="mt-px h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        {reason}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {sending
                          ? formatTransfer(uploaded, file.size, speed)
                          : uploading
                            ? `${formatBytes(file.size)} · waiting`
                            : formatBytes(file.size)}
                      </p>
                    )}
                    {sending && (
                      <Progress
                        value={progress}
                        aria-label={`Upload progress for ${file.name}`}
                        className="mt-2 h-1.5"
                      />
                    )}
                  </div>
                  {uploading ? (
                    sending && (
                      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                        {progress}%
                      </span>
                    )
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => {
                        if (failure?.key === key) setFailure(undefined)
                        queue.remove(key)
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              )
            })}
            {finished.map((row) => (
              <li key={row.key} className="flex items-center gap-3 p-3">
                <Thumb preview={row.preview} done />
                <div className="min-w-0 flex-1">
                  <a
                    href={row.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={row.name}
                    className="block truncate rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.name}
                  </a>
                  <p
                    className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
                    title={row.link}
                  >
                    {readable(row.link)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  aria-label={`Copy link for ${row.name}`}
                  onClick={() => void copy(row.link)}
                >
                  {copied === row.link ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">
                    {copied === row.link ? 'Copied' : 'Copy link'}
                  </span>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                >
                  <a
                    href={row.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${row.name}`}
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Thumb({ preview, done }: { preview?: string; done?: boolean }) {
  return (
    <div className="relative h-10 w-10 shrink-0">
      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-muted">
        {preview ? (
          <Image
            src={preview}
            alt=""
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 object-cover"
          />
        ) : (
          <FileIcon
            className="h-5 w-5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      {done && (
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
          <span className="sr-only">Uploaded</span>
        </span>
      )}
    </div>
  )
}
