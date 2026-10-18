'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { ArrowDownToLine, Loader2, Maximize2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { ARCHIVE_ISSUE_MESSAGES } from '@/lib/archives/shared'
import { formatBytes } from '@/lib/utils'

import {
  type ArchiveFileRef,
  ArchiveRequestError,
  type ArchiveRow,
  type ArchiveSource,
  IMAGE_PREVIEW_BYTES,
  TEXT_PREVIEW_BYTES,
  archiveEntryHref,
  archiveEntryName,
  archiveErrorMessage,
  archivePreviewKind,
  readPreviewBytes,
} from './archive-utils'

function Waiting({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  )
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function ImagePreview({
  src,
  name,
  size,
  onExpand,
}: {
  src: string
  name: string
  size: number
  onExpand?: () => void
}) {
  const [requested, setRequested] = useState(size <= IMAGE_PREVIEW_BYTES)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  if (!requested)
    return (
      <div className="space-y-3">
        <Unavailable>
          This image is {formatBytes(size)}. Large images can be slow to open.
        </Unavailable>
        <Button size="sm" variant="outline" onClick={() => setRequested(true)}>
          Load preview
        </Button>
      </div>
    )
  if (state === 'failed')
    return (
      <Unavailable>
        Your browser couldn’t display this image. Download the entry to open it.
      </Unavailable>
    )
  return (
    <div className="group relative flex min-h-40 items-center justify-center">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Waiting label="Loading image…" />
        </div>
      )}
      {/* The server sends inline image bytes only after checking their signature. */}
      <img
        src={src}
        alt={`Preview of ${name}`}
        decoding="async"
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
        className={
          state === 'ready'
            ? 'mx-auto max-h-80 max-w-full rounded-lg object-contain'
            : 'h-0 w-0 opacity-0'
        }
      />
      {state === 'ready' && onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand ${name}`}
          title="Expand image"
          className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function MediaPreview({
  src,
  name,
  kind,
}: {
  src: string
  name: string
  kind: 'video' | 'audio'
}) {
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <Unavailable>
        Your browser can’t play this file. Download the entry to open it on your
        device.
      </Unavailable>
    )
  // Range requests let the browser stream and seek without the whole member.
  return kind === 'video' ? (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label={`${name} video player`}
      onError={() => setFailed(true)}
      className="max-h-80 w-full rounded-lg bg-black"
    />
  ) : (
    <audio
      src={src}
      controls
      preload="metadata"
      aria-label={`${name} audio player`}
      onError={() => setFailed(true)}
      className="w-full"
    />
  )
}

function TextPreview({ src, size }: { src: string; size: number }) {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(0)
  const [state, setState] = useState<
    'loading' | 'more' | 'ready' | 'binary' | 'failed'
  >('loading')
  const [error, setError] = useState<{ message: string; retry: boolean }>()
  const decoder = useRef(new TextDecoder())
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(
    async (offset: number) => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      setState(offset ? 'more' : 'loading')
      setError(undefined)
      if (!size) {
        setState('ready')
        return
      }
      try {
        const response = await fetch(src, {
          cache: 'no-store',
          signal: current.signal,
          headers: {
            Range: `bytes=${offset}-${offset + TEXT_PREVIEW_BYTES - 1}`,
          },
        })
        if (!response.ok) {
          const result = await response.json().catch(() => ({}))
          throw new ArchiveRequestError(
            result.error || 'This entry could not be loaded. Please try again.',
            response.status
          )
        }
        const { bytes } = await readPreviewBytes(response, TEXT_PREVIEW_BYTES)
        if (current.signal.aborted) return
        if (!offset && bytes.subarray(0, 8000).includes(0)) {
          setState('binary')
          return
        }
        const end = offset + bytes.length
        const chunk = decoder.current.decode(bytes, { stream: end < size })
        setText((previous) => (offset ? previous + chunk : chunk))
        setLoaded(end)
        setState('ready')
      } catch (cause) {
        if (current.signal.aborted) return
        const status = (cause as { status?: number }).status
        setError({
          message: archiveErrorMessage(cause),
          // Damaged or unsupported entries fail the same way every time.
          retry: !status || status === 408 || status === 429 || status >= 500,
        })
        setState('failed')
      }
    },
    [src, size]
  )

  useEffect(() => {
    decoder.current = new TextDecoder()
    void load(0)
    return () => controller.current?.abort()
  }, [load])

  if (state === 'loading') return <Waiting label="Loading preview…" />
  if (state === 'binary')
    return (
      <Unavailable>
        This file looks like binary data, so it isn’t shown as text. Download
        the entry to open it.
      </Unavailable>
    )
  return (
    <div className="space-y-3">
      {(loaded > 0 || state !== 'failed') && (
        <pre
          className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed"
          aria-label="Entry text"
        >
          {text || (loaded ? '' : '(Empty file)')}
        </pre>
      )}
      {state === 'failed' ? (
        <div className="space-y-3">
          <p role="alert" className="break-words text-sm text-destructive">
            {error?.message}
          </p>
          {error?.retry && (
            <Button size="sm" variant="outline" onClick={() => load(loaded)}>
              Retry preview
            </Button>
          )}
        </div>
      ) : (
        loaded < size && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Showing the first {formatBytes(loaded)} of {formatBytes(size)}.
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={state === 'more'}
              onClick={() => load(loaded)}
            >
              {state === 'more' && (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              )}
              Load more
            </Button>
          </div>
        )
      )}
    </div>
  )
}

export function ArchiveEntryPreview({
  file,
  source,
  entry,
  onExpandImage,
}: {
  file: ArchiveFileRef
  source: ArchiveSource
  entry: ArchiveRow & { position: number }
  onExpandImage?: () => void
}) {
  const name = archiveEntryName(entry.path)
  const folder = entry.path.includes('/')
    ? entry.path.slice(0, entry.path.lastIndexOf('/'))
    : ''
  const kind = entry.issue ? null : archivePreviewKind(entry.path)?.type
  const inline = archiveEntryHref(file.id, source, entry.position, {
    inline: true,
  })
  const download = archiveEntryHref(file.id, source, entry.position)

  return (
    <section
      className="flex min-w-0 flex-col rounded-xl border bg-muted/10"
      aria-label="Entry preview"
    >
      <div className="flex flex-col items-start gap-3 border-b p-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium">{name}</h3>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {folder ? `${folder} · ` : ''}
            {formatBytes(entry.size)}
          </p>
        </div>
        {!entry.issue && (
          <Button variant="outline" size="sm" asChild>
            <a href={download} download={name}>
              <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
              Download entry
            </a>
          </Button>
        )}
      </div>
      <div className="min-h-40 min-w-0 p-4">
        {entry.issue ? (
          <Unavailable>{ARCHIVE_ISSUE_MESSAGES[entry.issue]}</Unavailable>
        ) : kind === 'image' ? (
          <ImagePreview
            src={inline}
            name={name}
            size={entry.size}
            onExpand={onExpandImage}
          />
        ) : kind === 'video' || kind === 'audio' ? (
          <MediaPreview src={inline} name={name} kind={kind} />
        ) : kind === 'text' ? (
          <TextPreview src={download} size={entry.size} />
        ) : (
          <Unavailable>
            Preview isn’t available for this file type. Download the entry to
            open it on your device.
          </Unavailable>
        )}
      </div>
    </section>
  )
}
