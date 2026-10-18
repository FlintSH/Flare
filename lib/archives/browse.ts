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
    recheck: () => Promise<void>
  }
) {
  const view = await getArchiveIndex(ref, {
    signal: options.signal,
    wait: options.progress ? PROGRESS_WAIT_MS : 'complete',
  })
  if (!view.complete || !view.index) {
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
  // Reading the archive took time; confirm access before returning its contents.
  if (!view.cached) await options.recheck()
  return NextResponse.json({
    data: view.index.listing(options.after),
    success: true,
  })
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
  const { index, entry, view } = await findArchiveEntry(ref, selector, signal)
  if (!view.cached) await options.recheck()
  const release = reserveEntryStream(options.requester)
  let source
  try {
    source = await openByteSource(ref.storage, ref.path, {
      size: index.archiveBytes,
      signal,
    })
  } catch (error) {
    release()
    throw error
  }
  return entryResponse({
    source,
    index,
    entry,
    range: options.request.headers.get('range'),
    inline: options.inline,
    release,
    signal,
    // A continuation range (seeking or resuming) is not a new read.
    prepared: (start, length) =>
      start === 0 ? options.audit(entry, length) : Promise.resolve(),
  })
}
