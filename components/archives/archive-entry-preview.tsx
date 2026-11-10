'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ArrowDownToLine, Loader2 } from 'lucide-react'

import {
  type CheckerTone,
  checkerClassName,
  checkerToneFor,
} from '@/components/file/checker-tone'
import { ExpandImageButton } from '@/components/file/viewer/components/expand-image-button'
import { Button } from '@/components/ui/button'

import { entryMediaType } from '@/lib/archives/client/encrypted-archive'
import { ARCHIVE_ISSUE_MESSAGES } from '@/lib/archives/shared'
import { readPreviewBytes } from '@/lib/client/preview-bytes'
import { refusal, retryable } from '@/lib/client/request'
import { formatBytes } from '@/lib/utils'

import {
  type ArchiveFileRef,
  type ArchiveRow,
  type ArchiveSource,
  IMAGE_PREVIEW_BYTES,
  TEXT_PREVIEW_BYTES,
  archiveEntryHref,
  archiveEntryName,
  archiveErrorMessage,
  archivePreviewKind,
} from './archive-utils'
import {
  ENTRY_MEMORY_LIMIT_BYTES,
  type EncryptedArchiveHandle,
} from './encrypted-archive-handle'

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
  const [tone, setTone] = useState<CheckerTone>(null)
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
    <div className="relative flex min-h-40 items-center justify-center">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Waiting label="Loading image…" />
        </div>
      )}
      <div className="relative max-w-full">
        {/* The server sends inline image bytes only after checking their signature. */}
        <img
          src={src}
          alt={`Preview of ${name}`}
          decoding="async"
          onLoad={(event) => {
            setTone(checkerToneFor(event.currentTarget))
            setState('ready')
          }}
          onError={() => setState('failed')}
          className={
            state === 'ready'
              ? `${checkerClassName(tone)} block max-h-80 max-w-full rounded-lg object-contain`
              : 'h-0 w-0 opacity-0'
          }
        />
        {state === 'ready' && onExpand && (
          <ExpandImageButton onClick={onExpand} aria-label={`Expand ${name}`} />
        )}
      </div>
    </div>
  )
}

function MediaPreview({
  src,
  name,
  kind,
  recover,
}: {
  src: string
  name: string
  kind: 'video' | 'audio'
  /** Makes `src` answer again after a failure. Resolves false if it cannot. */
  recover?: () => Promise<boolean>
}) {
  const [failed, setFailed] = useState(false)
  const retried = useRef(false)
  const onError = (event: React.SyntheticEvent<HTMLMediaElement>) => {
    const element = event.currentTarget
    if (!recover || retried.current) return setFailed(true)
    retried.current = true
    const time = element.currentTime
    void recover().then((ready) => {
      if (!ready) return setFailed(true)
      element.load()
      if (time > 0) element.currentTime = time
    })
  }
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
      onError={onError}
      className="max-h-80 w-full rounded-lg bg-black"
    />
  ) : (
    <audio
      src={src}
      controls
      preload="metadata"
      aria-label={`${name} audio player`}
      onError={onError}
      className="w-full"
    />
  )
}

/**
 * An image, video or audio entry of an encrypted archive. With a service
 * worker it plays from a local address, in ranges. Without one the entry is
 * decrypted into memory first, up to a limit. Either way it is shown only
 * as the fixed media type its extension stands for, never as a document.
 */
function EncryptedMedia({
  archive,
  entry,
  kind,
  name,
  onExpand,
}: {
  archive: EncryptedArchiveHandle
  entry: ArchiveRow & { position: number }
  kind: 'image' | 'video' | 'audio'
  name: string
  onExpand?: () => void
}) {
  const playable = entryMediaType(entry.path) !== null
  const direct = playable ? archive.mediaUrl(entry.position) : null
  const limit =
    kind === 'image' ? IMAGE_PREVIEW_BYTES : ENTRY_MEMORY_LIMIT_BYTES
  const [loaded, setLoaded] = useState<{
    src?: string
    problem?: 'large' | 'failed'
  }>({})
  const { position } = entry
  useEffect(() => {
    if (!playable || direct) return
    let stale = false
    archive.blobUrl(position, limit).then(
      (src) => {
        if (!stale) setLoaded({ src })
      },
      (cause: unknown) => {
        if (!stale)
          setLoaded({
            problem: cause instanceof RangeError ? 'large' : 'failed',
          })
      }
    )
    return () => {
      stale = true
    }
  }, [archive, position, playable, direct, limit])
  if (!playable)
    return (
      <Unavailable>
        Preview isn’t available for this file type. Download the entry to open
        it on your device.
      </Unavailable>
    )
  const src = direct ?? loaded.src
  if (loaded.problem === 'large')
    return (
      <Unavailable>
        This entry is {formatBytes(entry.size)}. Without a service worker, your
        browser previews entries of an encrypted archive up to{' '}
        {formatBytes(limit)}. Download the entry to open it.
      </Unavailable>
    )
  if (loaded.problem)
    return (
      <Unavailable>
        This entry could not be read. Download the whole archive to open it.
      </Unavailable>
    )
  if (!src) return <Waiting label="Decrypting…" />
  return kind === 'image' ? (
    <ImagePreview
      src={src}
      name={name}
      size={direct ? entry.size : 0}
      onExpand={direct ? onExpand : undefined}
    />
  ) : (
    <MediaPreview
      src={src}
      name={name}
      kind={kind}
      recover={direct ? () => archive.refresh(position) : undefined}
    />
  )
}

/** Reads up to `TEXT_PREVIEW_BYTES` of an entry from `offset`. */
type ReadText = (offset: number, signal: AbortSignal) => Promise<Uint8Array>

/** An entry the server sends: one ranged request for each part. */
function serverText(src: string): ReadText {
  return async (offset, signal) => {
    const response = await fetch(src, {
      cache: 'no-store',
      signal,
      headers: {
        Range: `bytes=${offset}-${offset + TEXT_PREVIEW_BYTES - 1}`,
      },
    })
    if (!response.ok)
      throw await refusal(
        response,
        'This entry could not be loaded. Please try again.'
      )
    return (await readPreviewBytes(response, TEXT_PREVIEW_BYTES)).bytes
  }
}

function TextPreview({ read, size }: { read: ReadText; size: number }) {
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
        const bytes = await read(offset, current.signal)
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
        setError({
          message: archiveErrorMessage(cause),
          // Damaged or unsupported entries fail the same way every time.
          retry: retryable(cause),
        })
        setState('failed')
      }
    },
    [read, size]
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
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
  // An encrypted archive has no address on the server for an entry: this
  // browser decrypts it (docs/e2ee-spec.md, section 12.3).
  const encrypted = source.kind === 'encrypted' ? source.archive : null
  const inline = encrypted
    ? null
    : archiveEntryHref(
        file.id,
        source as Exclude<ArchiveSource, { kind: 'encrypted' }>,
        entry.position,
        { inline: true }
      )
  const download = encrypted
    ? null
    : archiveEntryHref(
        file.id,
        source as Exclude<ArchiveSource, { kind: 'encrypted' }>,
        entry.position
      )
  const { position } = entry
  const readText = useMemo<ReadText>(
    () =>
      encrypted
        ? (offset, signal) =>
            encrypted.read(
              position,
              offset,
              offset + TEXT_PREVIEW_BYTES,
              signal
            )
        : serverText(download ?? ''),
    [encrypted, position, download]
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

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
        {!entry.issue && download && (
          <Button variant="outline" size="sm" asChild>
            <a href={download} download={name}>
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              Download entry
            </a>
          </Button>
        )}
        {!entry.issue && encrypted && (
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              setSaving(true)
              setSaveError('')
              encrypted
                .download(position)
                .catch((cause: unknown) =>
                  setSaveError(
                    cause instanceof RangeError
                      ? 'This entry is too large to save without a service worker in this browser. Download the whole archive instead.'
                      : archiveErrorMessage(cause)
                  )
                )
                .finally(() => setSaving(false))
            }}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
            )}
            Download entry
          </Button>
        )}
      </div>
      {saveError && (
        <p
          role="alert"
          className="break-words px-4 pt-3 text-sm text-destructive"
        >
          {saveError}
        </p>
      )}
      <div className="min-h-40 min-w-0 p-4">
        {entry.issue ? (
          <Unavailable>{ARCHIVE_ISSUE_MESSAGES[entry.issue]}</Unavailable>
        ) : encrypted && kind && kind !== 'text' ? (
          <EncryptedMedia
            archive={encrypted}
            entry={entry}
            kind={kind}
            name={name}
            onExpand={onExpandImage}
          />
        ) : kind === 'image' && inline ? (
          <ImagePreview
            src={inline}
            name={name}
            size={entry.size}
            onExpand={onExpandImage}
          />
        ) : (kind === 'video' || kind === 'audio') && inline ? (
          <MediaPreview src={inline} name={name} kind={kind} />
        ) : kind === 'text' ? (
          <TextPreview read={readText} size={entry.size} />
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
