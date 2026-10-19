import { Readable } from 'node:stream'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createGunzip, createInflateRaw } from 'node:zlib'
import {
  ZStream,
  Z_BLOCK,
  Z_BUF_ERROR,
  Z_OK,
  Z_STREAM_END,
  zlibInflate,
  zlibInflateEnd,
  zlibInflateInit2,
  zlibInflateReset,
} from 'pako'

import type { ByteSource } from './byte-source'
import { ArchiveError } from './errors'
import { concatStreams, sliceStream } from './stream-slice'

const WINDOW = 32 * 1024
const INPUT_CHUNK = 64 * 1024
/** Let other requests run after about this much decoded output. */
const YIELD_BYTES = 1024 * 1024

export interface GzipCheckpoint {
  /**
   * Compressed byte where decoding can resume: a deflate block that starts on
   * a byte boundary, or the header of a later gzip member.
   */
  input: number
  /** Uncompressed position at that byte. */
  output: number
  /** The 32 KiB of output preceding a block; null at a stream or member start. */
  window: Buffer | null
  /** A gzip member header, read with gunzip, which also crosses later members. */
  member?: boolean
}

/**
 * Access points that let a TAR.GZ or GZIP be read from the middle, in the
 * spirit of zlib's zran example. Only byte-aligned block boundaries are kept,
 * so Node's native inflater can resume with just a dictionary. Files made of
 * several gzip members also get an access point at member starts.
 */
export class GzipSeekIndex {
  readonly checkpoints: GzipCheckpoint[] = []
  /**
   * Where the second gzip member starts. Block points decode only the first
   * member, so this point is kept apart from the spaced, thinned checkpoints.
   */
  secondMember: GzipCheckpoint | null = null

  constructor(
    private span = 8 * 1024 ** 2,
    private readonly maxCheckpoints = 256
  ) {}

  get memoryBytes() {
    return this.checkpoints.length * (WINDOW + 64)
  }

  /** Uncompressed size of the first member when more members follow. */
  get firstMemberOutput() {
    return this.secondMember?.output ?? null
  }

  shouldAdd(output: number) {
    const last = this.checkpoints.at(-1)
    return !last || output - last.output >= this.span
  }

  add(checkpoint: GzipCheckpoint) {
    this.checkpoints.push(checkpoint)
    if (this.checkpoints.length <= this.maxCheckpoints) return
    // Keep memory bounded on huge streams: halve the points, double the gap.
    const kept = this.checkpoints.filter((_, index) => index % 2 === 0)
    this.checkpoints.splice(0, this.checkpoints.length, ...kept)
    this.span *= 2
  }

  /** The last access point at or before `output`. */
  before(output: number) {
    let low = 0
    let high = this.checkpoints.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (this.checkpoints[middle].output <= output) low = middle
      else high = middle - 1
    }
    return this.checkpoints[low]
  }

  /**
   * The closest point to resume decoding at `start`; null means the start of
   * the file. A block point can't reach past the first member, so a later
   * `start` resumes from a member start instead.
   */
  resumeFor(start: number): GzipCheckpoint | null {
    let point = this.checkpoints.length ? this.before(start) : null
    if (point && point.output > start) point = null
    const second = this.secondMember
    if (second && start >= second.output && !point?.member) return second
    return point
  }
}

/** Decoded bytes discarded to reach `start`. */
export function gzipDiscard(seek: GzipSeekIndex | null, start: number) {
  return start - (seek?.resumeFor(start)?.output ?? 0)
}

function damagedStream() {
  return new ArchiveError(
    'The compressed data is damaged or incomplete, so Flare can’t read past this point.'
  )
}

/**
 * Inflate a gzip stream once, yielding its output and recording access points.
 * Concatenated gzip members are read in full. Decoding runs on the main
 * thread, so it pauses briefly every {@link YIELD_BYTES} for other requests.
 */
export async function* inflateIndexed(
  input: AsyncIterable<Buffer>,
  seek: GzipSeekIndex,
  hooks: { consumed(bytes: number): void; tick(output: number): void }
): AsyncGenerator<Buffer> {
  const stream = new ZStream()
  if (zlibInflateInit2(stream, 16 + 15) !== Z_OK) throw damagedStream()
  const window = new Uint8Array(WINDOW)
  stream.avail_out = 0
  let totalIn = 0
  let totalOut = 0
  let sinceYield = 0
  let betweenMembers = false
  let carry: Buffer = Buffer.alloc(0)
  try {
    for await (const received of input) {
      carry = carry.length
        ? Buffer.concat([carry, received as Buffer])
        : (received as Buffer)
      while (carry.length) {
        if (betweenMembers) {
          if (carry.length < 2) break
          // Anything but another gzip member is trailing padding; stop there.
          if (carry[0] !== 0x1f || carry[1] !== 0x8b) return
          if (zlibInflateReset(stream) !== Z_OK) throw damagedStream()
          const memberStart: GzipCheckpoint = {
            input: totalIn,
            output: totalOut,
            window: null,
            member: true,
          }
          seek.secondMember ??= memberStart
          if (seek.shouldAdd(totalOut)) seek.add(memberStart)
          betweenMembers = false
        }
        const piece = carry.subarray(0, INPUT_CHUNK)
        stream.input = piece
        stream.next_in = 0
        stream.avail_in = piece.length
        while (stream.avail_in > 0 && !betweenMembers) {
          hooks.tick(totalOut)
          if (stream.avail_out === 0) {
            stream.output = window
            stream.next_out = 0
            stream.avail_out = WINDOW
          }
          const outputStart = stream.next_out
          const availableIn = stream.avail_in
          const result = zlibInflate(stream, Z_BLOCK)
          const consumed = availableIn - stream.avail_in
          const produced = stream.next_out - outputStart
          totalIn += consumed
          totalOut += produced
          hooks.consumed(totalIn)
          if (produced)
            yield Buffer.from(window.subarray(outputStart, stream.next_out))
          sinceYield += produced
          if (sinceYield >= YIELD_BYTES) {
            sinceYield = 0
            await nextTurn()
          }
          if (result === Z_STREAM_END) {
            betweenMembers = true
            break
          }
          if (
            (result !== Z_OK && result !== Z_BUF_ERROR) ||
            (!consumed && !produced)
          )
            throw damagedStream()
          const type = stream.data_type
          if (
            seek.firstMemberOutput === null &&
            type & 128 &&
            !(type & 64) &&
            (type & 7) === 0 &&
            seek.shouldAdd(totalOut)
          ) {
            let previous: Buffer | null = null
            if (totalOut > 0) {
              previous = Buffer.alloc(WINDOW)
              const left = stream.avail_out
              // The window is circular: older bytes sit after the write head.
              previous.set(window.subarray(WINDOW - left), 0)
              previous.set(window.subarray(0, WINDOW - left), left)
            }
            seek.add({ input: totalIn, output: totalOut, window: previous })
          }
        }
        carry = carry.subarray(stream.next_in)
      }
    }
    if (!betweenMembers) throw damagedStream()
  } finally {
    zlibInflateEnd(stream)
  }
}

/** Uncompressed `[start, end)` of a gzip stream, resuming near `start`. */
export async function openGzipRange(
  source: ByteSource,
  seek: GzipSeekIndex | null,
  start: number,
  end: number
): Promise<Readable> {
  if (end <= start) return Readable.from([], { objectMode: false })
  const point = seek?.resumeFor(start) ?? null
  if (!point || point.member) {
    // Node's gunzip continues across concatenated members in order.
    return sliceStream(
      await source.stream(point?.input ?? 0, source.size),
      createGunzip(),
      start - (point?.output ?? 0),
      end - start
    )
  }
  const second = seek?.secondMember
  const fromBlock = async (until: number) =>
    sliceStream(
      await source.stream(point.input, second?.input ?? source.size),
      createInflateRaw(point.window ? { dictionary: point.window } : undefined),
      start - point.output,
      until - start
    )
  if (!second || end <= second.output) return fromBlock(end)
  // The range runs past the first member: finish that member from the block
  // point, then continue from the second member's header.
  return concatStreams([
    () => fromBlock(second.output),
    async () =>
      sliceStream(
        await source.stream(second.input, source.size),
        createGunzip(),
        0,
        end - second.output
      ),
  ])
}
