import { fileTypeFromBuffer } from 'file-type'
import { Readable } from 'node:stream'

import { parseByteRange as parseSingleByteRange } from '@/lib/http/byte-range'

import type { ArchiveIndex, IndexedEntry } from './archive-index'
import type { ByteSource } from './byte-source'
import { discardedBefore, openEntryRange } from './entry-reader'
import { ArchiveError } from './errors'
import { ARCHIVE_BROWSE_LIMITS, ARCHIVE_ISSUE_MESSAGES } from './shared'
import { ARCHIVE_IDLE_MS, SLICE_PROGRESS, readUpTo } from './stream-slice'

/** Media a browser may render inline from an archive; never active documents. */
const INLINE_MEDIA: Record<string, string> = {
  'image/png': 'image/png',
  'image/apng': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
  'image/avif': 'image/avif',
  'image/bmp': 'image/bmp',
  'image/x-icon': 'image/x-icon',
  'video/mp4': 'video/mp4',
  'video/x-m4v': 'video/mp4',
  'video/quicktime': 'video/quicktime',
  'video/webm': 'video/webm',
  'video/matroska': 'video/x-matroska',
  'video/ogg': 'video/ogg',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/wav': 'audio/wav',
  'audio/ogg': 'audio/ogg',
  'audio/flac': 'audio/flac',
}

export function entryIssueError(entry: IndexedEntry) {
  return entry.issue
    ? new ArchiveError(ARCHIVE_ISSUE_MESSAGES[entry.issue], 415)
    : null
}

function tooFarIn() {
  return new ArchiveError(
    'This file is too far into a compressed archive for Flare to read. Download the whole archive to open it.',
    413
  )
}

/** One satisfiable byte range with an exclusive end, or null to send the whole entry. */
export function parseByteRange(
  header: string | null,
  size: number
): { start: number; end: number } | 'unsatisfiable' | null {
  const range = parseSingleByteRange(header, size)
  return range && range !== 'unsatisfiable'
    ? { start: range.start, end: range.end + 1 }
    : range
}

/** Detect inline media from the entry's own bytes; the name is never trusted. */
export async function entryMediaType(
  source: ByteSource,
  index: ArchiveIndex,
  entry: IndexedEntry
) {
  if (entry.mediaType !== undefined) return entry.mediaType
  const length = Math.min(entry.size, 4100)
  const detected = length
    ? await fileTypeFromBuffer(
        await readUpTo(
          await openEntryRange(source, index, entry, 0, length),
          length
        )
      )
    : undefined
  entry.mediaType = (detected && INLINE_MEDIA[detected.mime]) || null
  return entry.mediaType
}

const streamsKey = Symbol.for('flare.archive.entry-streams')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const streams = (processState[streamsKey] ??= {
  total: 0,
  requesters: new Map<string, number>(),
}) as { total: number; requesters: Map<string, number> }

/** Responses up to this size are read and verified before headers are sent. */
const BUFFERED_RESPONSE_BYTES = 512 * 1024
/**
 * Release a streamed response whose body nobody reads. Media players that
 * pause simply request the next range when they resume.
 */
export const IDLE_ENTRY_STREAM_MS = ARCHIVE_IDLE_MS

/** Open entry responses per process and per account or IP address. */
export const ARCHIVE_ENTRY_STREAMS = { total: 64, perRequester: 8 } as const

export function reserveEntryStream(requester: string) {
  const current = streams.requesters.get(requester) ?? 0
  if (
    streams.total >= ARCHIVE_ENTRY_STREAMS.total ||
    current >= ARCHIVE_ENTRY_STREAMS.perRequester
  )
    throw new ArchiveError(
      'Too many archive files are open at once. Close a preview or wait for a download to finish, then try again.',
      429
    )
  streams.total++
  streams.requesters.set(requester, current + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    streams.total--
    const remaining = (streams.requesters.get(requester) ?? 1) - 1
    if (remaining) streams.requesters.set(requester, remaining)
    else streams.requesters.delete(requester)
  }
}

function disposition(type: 'inline' | 'attachment', path: string) {
  const name = path.split('/').filter(Boolean).at(-1) || 'download'
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase()
  )
  return `${type}; filename*=UTF-8''${encoded}`
}

/**
 * Stream an entry with single-range support. The response owns `source` and
 * the stream reservation and releases both when the body finishes or aborts.
 */
export async function entryResponse(options: {
  source: ByteSource
  index: ArchiveIndex
  entry: IndexedEntry
  range: string | null
  inline: boolean
  /** HEAD: headers only. Next answers HEAD with GET and never reads the body. */
  head?: boolean
  release: () => void
  signal: AbortSignal
  /** Runs once the response is ready; `start` is the first byte served. */
  prepared?: (start: number, length: number) => Promise<void>
}): Promise<Response> {
  const { source, index, entry, release, signal } = options
  let handed = false
  const finish = () => {
    release()
    void source.close().catch(() => {})
  }
  try {
    const issue = entryIssueError(entry)
    if (issue) throw issue
    const { discardBytes } = ARCHIVE_BROWSE_LIMITS
    if (discardedBefore(index, entry, 0) > discardBytes) throw tooFarIn()
    let range = parseByteRange(options.range, entry.size)
    const common = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    }
    if (range === 'unsatisfiable') {
      finish()
      return new Response(null, {
        status: 416,
        headers: { ...common, 'Content-Range': `bytes */${entry.size}` },
      })
    }
    // A range deep in compressed data costs decoding everything before it.
    // HTTP lets a server ignore Range, so send the whole file instead.
    if (range && discardedBefore(index, entry, range.start) > discardBytes)
      range = null
    const mediaType = options.inline
      ? await entryMediaType(source, index, entry)
      : null
    const start = range?.start ?? 0
    const end = range?.end ?? entry.size
    const headers = {
      ...common,
      'Content-Type': mediaType ?? 'application/octet-stream',
      'Content-Length': String(end - start),
      'Content-Disposition': disposition(
        mediaType ? 'inline' : 'attachment',
        entry.path
      ),
      ...(range
        ? { 'Content-Range': `bytes ${start}-${end - 1}/${entry.size}` }
        : {}),
    }
    if (options.head) {
      finish()
      return new Response(null, { status: range ? 206 : 200, headers })
    }
    const stream = await openEntryRange(source, index, entry, start, end)
    if (end - start <= BUFFERED_RESPONSE_BYTES) {
      // Small reads (text previews, icons) finish before any header is sent,
      // so damage becomes a clear error instead of a cut-off body.
      const body = await readUpTo(stream, end - start)
      signal.throwIfAborted()
      await options.prepared?.(start, end - start)
      finish()
      return new Response(new Uint8Array(body), {
        status: range ? 206 : 200,
        headers,
      })
    }
    signal.throwIfAborted()
    await options.prepared?.(start, end - start)
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    const onAbort = () => stream.destroy()
    signal.addEventListener('abort', onAbort, { once: true })
    // Listen only after the web stream owns the reader, so this listener
    // never starts the flow itself.
    let idle = setTimeout(onAbort, IDLE_ENTRY_STREAM_MS)
    const active = () => {
      clearTimeout(idle)
      idle = setTimeout(onAbort, IDLE_ENTRY_STREAM_MS)
    }
    stream.on('data', active)
    stream.on(SLICE_PROGRESS, active)
    stream.once('close', () => {
      clearTimeout(idle)
      signal.removeEventListener('abort', onAbort)
      finish()
    })
    handed = true
    return new Response(body, { status: range ? 206 : 200, headers })
  } catch (error) {
    if (!handed) finish()
    throw error
  }
}
