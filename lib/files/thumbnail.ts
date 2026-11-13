import { fileTypeFromBuffer } from 'file-type'
import { availableParallelism } from 'node:os'
import type { Readable } from 'node:stream'

import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

/**
 * The widths thumbnails are made in. A request gets the first one that is at
 * least as wide as it asked for, so the widths a browser can choose from
 * share a few resized copies.
 */
export const THUMBNAIL_WIDTHS = [256, 384, 640, 828, 1080, 1920] as const

/** Larger originals are sent as they are rather than read into memory. */
const MAX_SOURCE_BYTES = 32 * 1024 ** 2
/** A decoded image past this many pixels is refused before it is decoded. */
const MAX_SOURCE_PIXELS = 100_000_000
/** How long reading an original may take, and again how long resizing it may. */
const MAX_SECONDS = 20
/**
 * Resizes that may wait for a slot. Past this the answer is the original at
 * once, so a flood of requests can't queue without end.
 */
const MAX_WAITING = 256
// The stored type is the uploader's claim, so the bytes' own signature
// decides. Nothing else reaches the image library: SVG is never rasterized
// here, and a GIF would lose its animation, so both are sent as they are.
const RESIZABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])
/** Resized copies kept in memory, in bytes. */
const CACHE_BYTES = 64 * 1024 ** 2
/** What an entry with no bytes counts as, so they are evicted too. */
const EMPTY_COST = 1024

type Thumbnail = Buffer | null
/** The requests waiting for one copy. One without a signal never gives up. */
type Requesters = (AbortSignal | undefined)[]

type ThumbnailState = {
  /** Least recently used first. Null marks an image that can't be resized. */
  cached: Map<string, Thumbnail>
  bytes: number
  making: Map<string, { thumbnail: Promise<Thumbnail>; requesters: Requesters }>
  running: number
  waiting: (() => void)[]
}

// Route bundles each load their own copy of this module; they share one cache.
const stateKey = Symbol.for('flare.files.thumbnails')
const processState = globalThis as typeof globalThis & {
  [stateKey]?: ThumbnailState
}
const state: ThumbnailState = (processState[stateKey] ??= {
  cached: new Map(),
  bytes: 0,
  making: new Map(),
  running: 0,
  waiting: [],
})

/**
 * The thumbnail width a `w` query value asks for; null when the value isn't
 * a positive whole number.
 */
export function thumbnailWidth(value: string): number | null {
  if (!/^[1-9]\d{0,5}$/.test(value)) return null
  const requested = Number(value)
  return (
    THUMBNAIL_WIDTHS.find((width) => width >= requested) ??
    THUMBNAIL_WIDTHS[THUMBNAIL_WIDTHS.length - 1]
  )
}

const cost = (thumbnail: Thumbnail) => thumbnail?.length ?? EMPTY_COST

function remember(key: string, thumbnail: Thumbnail) {
  state.cached.set(key, thumbnail)
  state.bytes += cost(thumbnail)
  for (const [oldest, bytes] of state.cached) {
    if (state.bytes <= CACHE_BYTES) break
    state.cached.delete(oldest)
    state.bytes -= cost(bytes)
  }
}

/**
 * Decoding is CPU work on Node's small thread pool, which file reads share.
 * Leave it a thread, so a screen of new thumbnails doesn't stall other I/O.
 * A slot is held from reading the original to the finished copy, which also
 * bounds how many originals are in memory at once. Null when too many
 * resizes already wait.
 */
async function withResizeSlot<T>(run: () => Promise<T>): Promise<T | null> {
  const slots = Math.max(1, Math.min(3, availableParallelism() - 1))
  if (state.running >= slots) {
    if (state.waiting.length >= MAX_WAITING) return null
    await new Promise<void>((resolve) => state.waiting.push(resolve))
  } else state.running++
  try {
    return await run()
  } finally {
    // A waiting resize takes this slot over; otherwise it is free again.
    const next = state.waiting.shift()
    if (next) next()
    else state.running--
  }
}

/** The stream's bytes; null past the size limit. Rejects at the deadline. */
async function read(
  stream: Readable,
  deadline: AbortSignal
): Promise<Buffer | null> {
  // Storage that honors the signal ends the stream itself; this covers a
  // body that stalls after its headers arrived.
  const stop = () => stream.destroy(deadline.reason)
  if (deadline.aborted) stop()
  else deadline.addEventListener('abort', stop, { once: true })
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      size += chunk.length
      if (size > MAX_SOURCE_BYTES) {
        stream.destroy()
        return null
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } finally {
    deadline.removeEventListener('abort', stop)
  }
}

async function resize(source: Buffer, width: number): Promise<Thumbnail> {
  const type = await fileTypeFromBuffer(source)
  if (!type || !RESIZABLE.has(type.mime)) return null
  // Loaded on first use: only this route needs the image library, and a
  // platform without its binary still serves originals.
  const { default: sharp } = await import('sharp')
  const image = sharp(source, {
    limitInputPixels: MAX_SOURCE_PIXELS,
    sequentialRead: true,
  })
  // An animated WebP or AVIF would lose its frames too.
  if (((await image.metadata()).pages ?? 1) > 1) return null
  return (
    image
      // Turn the pixels the way the camera recorded, as a browser shows them.
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 75 })
      .timeout({ seconds: MAX_SECONDS })
      .toBuffer()
  )
}

async function make(
  key: string,
  file: { id: string; path: string },
  width: number,
  requesters: Requesters
): Promise<Thumbnail> {
  // Every browser that asked has since given up, as when cards scroll out of
  // view while their previews wait. Don't make what nobody will see.
  if (requesters.every((signal) => signal?.aborted)) return null
  const reason = (error: unknown) => ({
    fileId: file.id,
    error: error instanceof Error ? error.message : String(error),
  })
  let source: Buffer | null
  try {
    const deadline = AbortSignal.timeout(MAX_SECONDS * 1000)
    const storage = await getStorageProvider()
    source = await read(
      await storage.getFileStream(file.path, undefined, deadline),
      deadline
    )
  } catch (error) {
    // Storage may answer next time, so this isn't remembered. The original's
    // own route reports what is wrong.
    logger.debug('Thumbnail source could not be read', reason(error))
    return null
  }
  const thumbnail = source
    ? await resize(source, width).catch((error) => {
        logger.debug('Thumbnail could not be resized', reason(error))
        return null
      })
    : null
  remember(key, thumbnail)
  return thumbnail
}

/**
 * A WebP copy of a stored image no wider than `width`, or null when the
 * original should be sent instead: it isn't a still JPEG, PNG, WebP or AVIF,
 * it is too large to resize, it couldn't be read or decoded in time, or too
 * many resizes are waiting. Copies are kept in memory up to `CACHE_BYTES`, so
 * a library's recent thumbnails are made once.
 *
 * `signal` is the request's: a copy every requester stopped waiting for is
 * not made, and they get null. The caller has already checked that the
 * requester may read the file, and checks again for every request, so a copy
 * of a file that was deleted or made private is never sent on its own: it
 * stays unreachable here until newer copies push it out. A file's bytes never
 * change under its ID and path, so they name its copies.
 */
export async function resizedThumbnail(
  file: { id: string; path: string; size: number },
  width: number,
  signal?: AbortSignal
): Promise<Thumbnail> {
  const key = `${file.id}:${file.path}:${width}`
  if (state.cached.has(key)) {
    const cached = state.cached.get(key)!
    // Move it to the recently used end.
    state.cached.delete(key)
    state.cached.set(key, cached)
    return cached
  }
  // `size` is in megabytes.
  if (file.size * 1024 ** 2 > MAX_SOURCE_BYTES) return null
  // Requests for the same copy while it is being made share the work.
  const making = state.making.get(key)
  if (making) {
    making.requesters.push(signal)
    return making.thumbnail
  }
  const requesters: Requesters = [signal]
  const thumbnail = withResizeSlot(() =>
    make(key, file, width, requesters)
  ).finally(() => state.making.delete(key))
  state.making.set(key, { thumbnail, requesters })
  return thumbnail
}
