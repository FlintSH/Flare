import { NextResponse } from 'next/server'

import type { Prisma } from '@prisma/client'

import { getStorageProvider } from '@/lib/storage'
import { getStorageProviderForTarget } from '@/lib/storage/target-provider'
import { parseStorageTarget } from '@/lib/storage/targets'

import type { IndexedEntry } from './archive-index'
import { openByteSource } from './byte-source'
import { entryResponse, reserveEntryStream } from './entry-response'
import { ArchiveError } from './errors'
import {
  type ArchiveEntrySelector,
  type ArchiveSourceRef,
  findArchiveEntry,
  getArchiveIndex,
} from './index-cache'
import {
  ARCHIVE_BROWSE_LIMITS,
  type ArchiveListingProgress,
  getArchiveFormat,
} from './shared'
import { ARCHIVE_IDLE_MS, rejectOnAbort, storageStalled } from './stream-slice'

type BrowseSource = {
  id: string
  name: string
  path: string
  mimeType: string
  storageTarget: Prisma.JsonValue
}

/** How long a progress-mode listing waits before reporting progress. */
const PROGRESS_WAIT_MS = 750

export async function sourceStorage(file: Pick<BrowseSource, 'storageTarget'>) {
  const target = parseStorageTarget(file.storageTarget)
  if (file.storageTarget !== null && !target)
    throw new ArchiveError(
      'The file has invalid storage provenance. Ask the operator to reconcile it.',
      409
    )
  // Historical files use the active provider, matching existing file downloads.
  // A recorded target never silently falls back to a different backend.
  return target ? getStorageProviderForTarget(target) : getStorageProvider()
}

export async function archiveSourceRef(
  file: BrowseSource
): Promise<ArchiveSourceRef> {
  const format = getArchiveFormat(file.name, file.mimeType)
  if (!format)
    throw new ArchiveError('This archive format is not supported.', 415)
  const name = getArchiveFormat(file.name)
    ? file.name
    : `${file.name}.${format === 'gzip' ? 'gz' : format}`
  return {
    key: [file.id, file.path, JSON.stringify(file.storageTarget), name].join(
      '\u0000'
    ),
    storage: await sourceStorage(file),
    path: file.path,
    name,
    format,
  }
}

/**
 * List an archive. Progress mode returns 202 with the entries found so far
 * while a TAR, TAR.GZ, or GZIP is still being read; otherwise this waits.
 */
export async function archiveListing(
  ref: ArchiveSourceRef,
  options: {
    progress: boolean
    after: number
    signal: AbortSignal
    /** Account or IP address, for the per-requester indexing limit. */
    requester: string
    /** Locked access check, for the finished listing. */
    recheck: () => Promise<void>
    /** Lock-free access check, for progress polls. */
    confirm: () => Promise<void>
  }
) {
  const view = await getArchiveIndex(ref, {
    signal: options.signal,
    wait: options.progress ? PROGRESS_WAIT_MS : 'complete',
    requester: options.requester,
  })
  // Access can change while this request waits for the archive to be read.
  // Confirm it before returning any entry names, including partial progress.
  if (!view.complete || !view.index) {
    await options.confirm()
    const progress: ArchiveListingProgress = view.index?.progress(
      options.after
    ) ?? {
      status: 'indexing',
      format: ref.format,
      archiveBytes: 0,
      bytesRead: 0,
      entries: [],
      entriesFound: 0,
    }
    return NextResponse.json(
      { data: progress, success: true },
      { status: 202, headers: { 'Retry-After': '1' } }
    )
  }
  if (!view.cached) await options.recheck()
  if (options.after)
    return NextResponse.json({
      data: view.index.listing(options.after),
      success: true,
    })
  // Blob parts share the encoded listing instead of copying it.
  return new Response(
    new Blob(['{"data":', view.index.listingJson(), ',"success":true}'], {
      type: 'application/json',
    })
  )
}

/** Stream one file entry, honoring a single `Range` and inline media. */
export async function archiveEntry(
  ref: ArchiveSourceRef,
  selector: ArchiveEntrySelector,
  options: {
    request: Request
    requester: string
    inline: boolean
    recheck: () => Promise<void>
    audit: (entry: IndexedEntry, length: number) => Promise<void>
  }
) {
  if (
    'path' in selector &&
    (!selector.path || selector.path.length > ARCHIVE_BROWSE_LIMITS.pathLength)
  )
    throw new ArchiveError('Choose a valid archive entry.', 400)
  const { signal } = options.request
  const { index, entry, view } = await findArchiveEntry(ref, selector, {
    signal,
    requester: options.requester,
  })
  if (!view.cached) await options.recheck()
  const release = reserveEntryStream(options.requester)
  // Storage reads stop with the request. Preparing the response (opening the
  // source, detecting media, reading small entries) also has a deadline, so
  // stalled storage can't hold this request's stream slot.
  const reading = new AbortController()
  const stop = () => reading.abort(signal.reason)
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  const deadline = setTimeout(
    () => reading.abort(storageStalled()),
    ARCHIVE_IDLE_MS
  )
  const prepare = async () =>
    entryResponse({
      source: await openByteSource(ref.storage, ref.path, {
        size: index.archiveBytes,
        signal: reading.signal,
      }),
      index,
      entry,
      range: options.request.headers.get('range'),
      inline: options.inline,
      head: options.request.method === 'HEAD',
      release,
      signal: reading.signal,
      // A continuation range (seeking or resuming) is not a new read.
      prepared: (start, length) =>
        start === 0 ? options.audit(entry, length) : Promise.resolve(),
    })
  try {
    return await Promise.race([prepare(), rejectOnAbort(reading.signal)])
  } catch (error) {
    release()
    if (reading.signal.aborted && !signal.aborted) throw storageStalled()
    throw error
  } finally {
    clearTimeout(deadline)
  }
}
