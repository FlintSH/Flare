import { spawn } from 'node:child_process'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

import { loadSharp } from './thumbnail'
import { VIDEO_POSTER_SIZE } from './urls'

const logger = loggers.files

/** A still frame from a video, for its thumbnail and link previews. */
export interface VideoPoster {
  /** WebP, no wider or taller than `VIDEO_POSTER_SIZE`. */
  image: Buffer
  /** The frame's shape as the video shows it, in square pixels. */
  width: number
  height: number
}

/** How long finding, reading and decoding one frame may take in all. */
const MAX_SECONDS = 20
/** A frame larger than this as PNG isn't kept. */
const MAX_FRAME_BYTES = 24 * 1024 ** 2
/** Frames kept in memory, in bytes, in front of the saved ones. */
const CACHE_BYTES = 32 * 1024 ** 2
/**
 * How long a video without a frame isn't tried again in this process: long
 * enough that a library of them doesn't keep ffmpeg busy, short enough that
 * installing ffmpeg or storage recovering shows frames without a restart.
 */
const RETRY_MS = 10 * 60 * 1000
/**
 * How long a video ffmpeg ran on but got no frame from is remembered across
 * restarts. Its bytes never change, but ffmpeg also fails when S3 does, so it
 * is tried again after this.
 */
const SAVED_FAILURE_MS = 24 * 60 * 60 * 1000
/** Failures remembered at most; the oldest are forgotten first. */
const MAX_FAILED = 10_000
/**
 * ffmpeg processes at once, each decoding on one thread, so frames never take
 * more than two cores from the requests around them. How many more may wait.
 */
const RUNNING = 2
const MAX_WAITING = 64
/** Frames over 40 megapixels, a little more than 8K, are refused before they are decoded. */
const MAX_PIXELS = 40_000_000
/**
 * The containers ffmpeg may open. Uploads are untrusted, so playlist and
 * script formats that name other files or addresses are never read, whatever
 * the bytes claim to be.
 */
const FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,ogg,mpegts,flv'
// Shrink the frame to the shape the video plays in, non-square pixels made
// square, within VIDEO_POSTER_SIZE and never larger than the video.
const fit = `min(1,min(${VIDEO_POSTER_SIZE}/(iw*sar),${VIDEO_POSTER_SIZE}/ih))`
const FILTER = [
  `scale=w='max(2,trunc(iw*sar*${fit}/2)*2)':h='max(2,trunc(ih*${fit}/2)*2)'`,
  'setsar=1',
].join(',')

type Poster = VideoPoster | null
/**
 * A frame, null when the video has none to show, or `busy` when too many
 * frames are waiting to be made, or everyone who asked for this one left.
 */
export type PosterAnswer = Poster | 'busy'
type Requesters = (AbortSignal | undefined)[]

type PosterState = {
  /** Least recently used first. */
  cached: Map<string, VideoPoster>
  bytes: number
  /** Videos with no frame to show, until when they aren't tried again. */
  failed: Map<string, number>
  making: Map<
    string,
    { answer: Promise<PosterAnswer>; requesters: Requesters; leave: () => void }
  >
  running: number
  waiting: (() => void)[]
  warned: boolean
}

// Route bundles each load their own copy of this module; they share one cache.
const stateKey = Symbol.for('flare.files.videoPosters')
const processState = globalThis as typeof globalThis & {
  [stateKey]?: PosterState
}
const state: PosterState = (processState[stateKey] ??= {
  cached: new Map(),
  bytes: 0,
  failed: new Map(),
  making: new Map(),
  running: 0,
  waiting: [],
  warned: false,
})

/** The ffmpeg Flare runs: `FLARE_FFMPEG_PATH`, or `ffmpeg` on the PATH. */
export function ffmpegCommand() {
  return process.env.FLARE_FFMPEG_PATH?.trim() || 'ffmpeg'
}

function remember(key: string, poster: VideoPoster) {
  // Two requests that missed the cache together both remember the frame.
  const replaced = state.cached.get(key)
  if (replaced) state.bytes -= replaced.image.length
  state.cached.delete(key)
  state.cached.set(key, poster)
  state.bytes += poster.image.length
  for (const [oldest, kept] of state.cached) {
    if (state.bytes <= CACHE_BYTES) break
    state.cached.delete(oldest)
    state.bytes -= kept.image.length
  }
}

function fail(key: string) {
  state.failed.delete(key)
  state.failed.set(key, Date.now() + RETRY_MS)
  for (const oldest of state.failed.keys()) {
    if (state.failed.size <= MAX_FAILED) break
    state.failed.delete(oldest)
  }
}

const abandoned = (requesters: Requesters) =>
  requesters.every((signal) => signal?.aborted)

/**
 * Runs `run` once one of the `RUNNING` slots is free. A request that waits
 * gives up its place once every requester has left, as when cards scroll out
 * of view, so they don't hold up the cards that replaced them.
 */
async function withSlot<T>(
  run: () => Promise<T>,
  requesters: Requesters,
  onLeave: (leave: () => void) => void
): Promise<T | 'busy'> {
  // A request can be cancelled before it gets here, while its access is
  // checked; an abort listener added now would never fire for it.
  if (abandoned(requesters)) return 'busy'
  if (state.running >= RUNNING) {
    if (state.waiting.length >= MAX_WAITING) return 'busy'
    const started = await new Promise<boolean>((resolve) => {
      const start = () => resolve(true)
      state.waiting.push(start)
      onLeave(() => {
        const at = state.waiting.indexOf(start)
        if (at < 0 || !abandoned(requesters)) return
        state.waiting.splice(at, 1)
        resolve(false)
      })
    })
    if (!started) return 'busy'
  } else state.running++
  try {
    return abandoned(requesters) ? 'busy' : await run()
  } finally {
    const next = state.waiting.shift()
    if (next) next()
    else state.running--
  }
}

class FfmpegMissing extends Error {}
/** ffmpeg ran on the video and gave no frame. */
class FrameFailed extends Error {}

/**
 * One PNG frame from `source` starting `seconds` in; empty when the video
 * ends before then. Rejects when ffmpeg can't run, fails, or is still
 * running at `deadline`, a time in milliseconds.
 */
function frame(
  source: { input: string; protocols: string },
  seconds: number,
  deadline: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now()
    if (left <= 0) {
      reject(new Error(`No frame within ${MAX_SECONDS} s`))
      return
    }
    const child = spawn(
      /* turbopackIgnore: true */ ffmpegCommand(),
      [
        ...['-nostdin', '-hide_banner', '-loglevel', 'error'],
        ...['-protocol_whitelist', source.protocols],
        ...['-format_whitelist', FORMATS],
        ...['-threads', '1', '-max_pixels', String(MAX_PIXELS)],
        ...['-ss', String(seconds), '-i', source.input],
        // The first real video stream, never cover art.
        ...['-map', '0:V:0', '-frames:v', '1', '-an', '-sn', '-dn'],
        ...['-vf', FILTER, '-f', 'image2pipe', '-c:v', 'png'],
        // Uncompressed: sharp reads it at once, and deflating it in ffmpeg
        // took a quarter of the whole frame's time.
        ...['-compression_level', '0', 'pipe:1'],
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const chunks: Buffer[] = []
    let size = 0
    let errors = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`No frame within ${MAX_SECONDS} s`))
    }, left)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_FRAME_BYTES) {
        child.kill('SIGKILL')
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length < 2000) errors += chunk.toString()
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(error.code === 'ENOENT' ? new FfmpegMissing() : error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (size > MAX_FRAME_BYTES) reject(new Error('Frame too large'))
      else if (code === 0) resolve(Buffer.concat(chunks))
      else
        reject(
          new FrameFailed(
            errors.trim().split('\n').pop() || `ffmpeg exited ${code}`
          )
        )
    })
  })
}

async function make(file: { id: string; path: string }): Promise<Poster> {
  const storage = await getStorageProvider()
  // ffmpeg reads only the parts it needs: the file itself on local storage,
  // or ranges of a short-lived signed URL from S3.
  const local = storage.localPath?.(file.path)
  const input = local ?? (await storage.getPublicUrl(file.path))
  if (!input) return null
  const source = { input, protocols: local ? 'file' : 'http,https,tcp,tls' }
  const deadline = Date.now() + MAX_SECONDS * 1000
  // A video shorter than a second has no frame there, so it starts over.
  let png = await frame(source, 1, deadline)
  if (!png.length) png = await frame(source, 0, deadline)
  if (!png.length) return null
  const sharp = await loadSharp()
  const { data, info } = await sharp(png)
    // Half the time of the default effort, for a few percent more bytes.
    .webp({ quality: 75, effort: 2 })
    .toBuffer({ resolveWithObject: true })
  return { image: data, width: info.width, height: info.height }
}

/**
 * The frame saved for this file: a frame, null for a video ffmpeg got none
 * from lately, or undefined when there is nothing to go by.
 */
async function saved(file: {
  id: string
  path: string
}): Promise<Poster | undefined> {
  let row
  try {
    row = await prisma.videoFrame.findUnique({ where: { fileId: file.id } })
  } catch (error) {
    // Treated as unknown: the frame is made, as before there was a table.
    logger.debug('Saved video frame could not be read', {
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
  if (!row || row.path !== file.path) return undefined
  if (row.image && row.width && row.height)
    return {
      image: Buffer.from(row.image),
      width: row.width,
      height: row.height,
    }
  return Date.now() - row.createdAt.getTime() < SAVED_FAILURE_MS
    ? null
    : undefined
}

/** Saves a frame, or that ffmpeg got none, for every process and restart. */
async function save(file: { id: string; path: string }, poster: Poster) {
  const data = {
    path: file.path,
    image: poster ? new Uint8Array(poster.image) : null,
    width: poster?.width ?? null,
    height: poster?.height ?? null,
    createdAt: new Date(),
  }
  try {
    await prisma.videoFrame.upsert({
      where: { fileId: file.id },
      create: { fileId: file.id, ...data },
      update: data,
    })
  } catch (error) {
    // The file was deleted meanwhile, or the database is away: the frame is
    // made again when it is next asked for.
    logger.debug('Video frame could not be saved', {
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * `videoPoster`, given at most `ms` to answer: null once that has passed.
 * The frame is still made and kept, so the next request finds it.
 */
export async function videoPosterWithin(
  file: { id: string; path: string },
  ms: number
): Promise<VideoPoster | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    videoPoster(file).then((answer) => (answer === 'busy' ? null : answer)),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * A frame from a stored video, or null when there is none to show: ffmpeg
 * isn't installed, or the video can't be read or decoded in time or has no
 * picture. `busy` when too many frames are already waiting to be made.
 * ffmpeg runs once per video: the frame is saved with the file, and kept in
 * memory up to `CACHE_BYTES` in front of that. A video ffmpeg got no frame
 * from isn't tried again for `SAVED_FAILURE_MS`; one that failed otherwise,
 * as when ffmpeg is missing, for `RETRY_MS`.
 *
 * `signal` is the request's: a frame every requester stopped waiting for
 * isn't made. Without one, the caller waits for the answer.
 *
 * The caller has already checked that the requester may read the file, and
 * checks again for every request. A file's bytes never change under its ID
 * and path, so they name its frame.
 */
export async function videoPoster(
  file: { id: string; path: string },
  signal?: AbortSignal
): Promise<PosterAnswer> {
  const key = `${file.id}:${file.path}`
  const cached = state.cached.get(key)
  if (cached) {
    // Move it to the recently used end.
    state.cached.delete(key)
    state.cached.set(key, cached)
    return cached
  }
  if ((state.failed.get(key) ?? 0) > Date.now()) return null
  const making = state.making.get(key)
  if (making) {
    making.requesters.push(signal)
    signal?.addEventListener('abort', making.leave, { once: true })
    return making.answer
  }
  const requesters: Requesters = [signal]
  let leave = () => {}
  const answer = (async (): Promise<PosterAnswer> => {
    // A frame made before, by this process or another, or before a restart.
    const known = await saved(file)
    if (known !== undefined) {
      if (known) remember(key, known)
      else fail(key)
      return known
    }
    return withSlot(
      () => made(file, key),
      requesters,
      (left) => {
        leave = left
        signal?.addEventListener('abort', left, { once: true })
      }
    )
  })().finally(() => state.making.delete(key))
  state.making.set(key, { answer, requesters, leave: () => leave() })
  return answer
}

/** Runs ffmpeg for a frame, and remembers and saves what came of it. */
async function made(
  file: { id: string; path: string },
  key: string
): Promise<Poster> {
  try {
    const poster = await make(file)
    if (poster) remember(key, poster)
    else fail(key)
    await save(file, poster)
    return poster
  } catch (error) {
    fail(key)
    if (error instanceof FrameFailed) await save(file, null)
    if (error instanceof FfmpegMissing) {
      if (!state.warned) {
        state.warned = true
        logger.warn(
          `Video thumbnails are off: ${ffmpegCommand()} could not be run. Install ffmpeg or set FLARE_FFMPEG_PATH.`
        )
      }
      return null
    }
    logger.debug('Video frame could not be made', {
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * A frame already made for this video, without waiting for ffmpeg: from
 * memory or the saved frames. When there is none yet, one is started in the
 * background, so the page's own request for it finds it sooner.
 */
export async function readyVideoPoster(file: {
  id: string
  path: string
}): Promise<VideoPoster | null> {
  const key = `${file.id}:${file.path}`
  const cached = state.cached.get(key)
  if (cached) return cached
  if (state.making.has(key) || (state.failed.get(key) ?? 0) > Date.now())
    return null
  const known = await saved(file)
  if (known) {
    remember(key, known)
    return known
  }
  if (known === undefined) void videoPoster(file)
  return null
}
