import { E2eeError } from '../errors'
import {
  CHUNK_SIZE,
  type ContentContext,
  type FileLayout,
  HEADER_LENGTH,
  STORED_CHUNK_SIZE,
  contentContext,
  decryptChunk,
  fileLayout,
  storedChunkOffset,
  wipeContentContext,
} from '../file'
import { wipe } from '../primitives'
import { asFileKey } from '../types'

/**
 * Reads parts of an encrypted file without the rest of it
 * (docs/e2ee-spec.md, sections 7.5 and 12.2). A plaintext range becomes the
 * stored chunks that hold it, those chunks are requested with one `Range`
 * header, and no byte of a chunk is given out before its tag is correct.
 *
 * It runs in a page, a worker and a service worker: it needs only `fetch`.
 * All cryptography is the chunk functions of `lib/e2ee/file.ts`.
 *
 * THE END OF THE FILE. The server says how long the stored file is, and the
 * server is not trusted. A range that does not hold the final chunk proves
 * nothing about where the file ends (section 7.4). `verifyEnd` reads the
 * final chunk the length implies and checks its tag with `final_flag = 1`:
 * the tag binds the chunk index, so a length that is too short or too long
 * fails there. A caller that shows or saves ranges as parts of one whole
 * file calls `verifyEnd` first.
 */

/** Why the ciphertext could not be read. Never a secret. */
export type SourceFailure =
  /** The server answered with an error status. */
  | 'refused'
  /** The server's answer is not the range that was asked for. */
  | 'changed'
  /** No answer arrived, or it stopped before its end. */
  | 'network'

export class SourceError extends Error {
  constructor(
    readonly failure: SourceFailure,
    readonly status?: number
  ) {
    super(`The encrypted file could not be read (${failure})`)
    this.name = 'SourceError'
  }
}

export type SourceFetch = (
  url: string,
  init: {
    headers?: Record<string, string>
    signal?: AbortSignal
    credentials: 'same-origin'
    cache: 'no-store'
  }
) => Promise<Response>

export interface EncryptedSourceInput {
  /** Where the stored file is served with byte ranges. */
  readonly url: string
  readonly fileKey: Uint8Array
  /** The 26-byte header. The caller has it from the file's records. */
  readonly header: Uint8Array
  /** The stored length as the server reports it. Not trusted. */
  readonly storedLength: number
  readonly fetch: SourceFetch
}

/** How many stored chunks one request asks for. */
export type RequestWindow =
  /** One request for all of the range. For a download, which reads to the end. */
  | 'whole'
  /** Starts small and doubles: a reader that stops early wastes little. */
  | 'adaptive'
  /** Exactly this many chunks. */
  | number

export interface StreamOptions {
  readonly window?: RequestWindow
  readonly signal?: AbortSignal
  /** Called with the stored bytes of each request before it is sent. */
  readonly onRequest?: (storedBytes: number) => void
  /** Added to the first request only: the server counts one download. */
  readonly countDownload?: boolean
}

const ADAPTIVE_FIRST_CHUNKS = 4
const ADAPTIVE_MAX_CHUNKS = 64

export interface EncryptedSource {
  readonly layout: FileLayout
  readonly plaintextLength: number
  /** Proves the stored length: reads the final chunk and checks its tag. */
  verifyEnd(signal?: AbortSignal): Promise<void>
  /** The plaintext bytes `[start, end)`, complete in memory. For small reads. */
  read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>
  /** The plaintext bytes `[start, end)` as verified pieces, in sequence. */
  stream(
    start: number,
    end: number,
    options?: StreamOptions
  ): AsyncGenerator<Uint8Array, void, undefined>
  /** Erases the content keys. The source cannot read after this. */
  close(): void
}

function contentRange(header: string | null) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header?.trim() ?? '')
  return match
    ? {
        start: Number(match[1]),
        end: Number(match[2]),
        total: Number(match[3]),
      }
    : null
}

/** Collects pieces of any size and gives back exact lengths. */
class Pieces {
  private parts: Uint8Array[] = []
  private offset = 0
  length = 0

  push(piece: Uint8Array) {
    if (!piece.length) return
    this.parts.push(piece)
    this.length += piece.length
  }

  take(count: number): Uint8Array {
    const head = this.parts[0]
    // The common case: one network piece holds the whole chunk.
    if (head.length - this.offset >= count) {
      const out = head.subarray(this.offset, this.offset + count)
      this.offset += count
      if (this.offset === head.length) {
        this.parts.shift()
        this.offset = 0
      }
      this.length -= count
      return out
    }
    const out = new Uint8Array(count)
    let written = 0
    while (written < count) {
      const part = this.parts[0]
      const wanted = Math.min(part.length - this.offset, count - written)
      out.set(part.subarray(this.offset, this.offset + wanted), written)
      written += wanted
      this.offset += wanted
      if (this.offset === part.length) {
        this.parts.shift()
        this.offset = 0
      }
    }
    this.length -= count
    return out
  }
}

/**
 * The stored length of a file, for a caller that has only its address: the
 * total that the server names in the answer to a request for the 26 header
 * bytes. Those bytes must be the header the caller has from the file's
 * records. The length is the server's word: `verifyEnd` proves it.
 */
export async function probeStoredLength(input: {
  readonly url: string
  readonly header: Uint8Array
  readonly fetch: SourceFetch
  readonly signal?: AbortSignal
}): Promise<number> {
  let response: Response
  try {
    response = await input.fetch(input.url, {
      headers: { Range: `bytes=0-${HEADER_LENGTH - 1}` },
      signal: input.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (error) {
    if (input.signal?.aborted) throw error
    throw new SourceError('network')
  }
  if (response.status !== 206) {
    void response.body?.cancel().catch(() => undefined)
    throw new SourceError(response.ok ? 'changed' : 'refused', response.status)
  }
  const range = contentRange(response.headers.get('content-range'))
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (input.signal?.aborted) throw error
    throw new SourceError('network')
  }
  if (
    !range ||
    range.start !== 0 ||
    range.end !== HEADER_LENGTH - 1 ||
    bytes.length !== HEADER_LENGTH ||
    !bytes.every((byte, index) => byte === input.header[index])
  )
    throw new SourceError('changed')
  return range.total
}

export function openEncryptedSource(
  input: EncryptedSourceInput
): EncryptedSource {
  const layout = fileLayout(input.storedLength)
  // A copy: the caller erases its key when it likes.
  const fileKey = asFileKey(input.fileKey.slice())
  let context: ContentContext | null
  try {
    context = contentContext(fileKey, input.header)
  } finally {
    wipe(fileKey)
  }
  let endVerified: Promise<void> | null = null
  const lastChunk = layout.chunkCount - 1

  const keys = () => {
    if (!context)
      throw new E2eeError('invalid_argument', 'The source is closed')
    return context
  }
  const storedLengthOfChunk = (index: number) =>
    index === lastChunk ? layout.finalStoredChunkLength : STORED_CHUNK_SIZE

  /** One request for the stored chunks `first` to `last`. */
  async function request(
    first: number,
    last: number,
    options: StreamOptions,
    count: boolean
  ): Promise<ReadableStream<Uint8Array>> {
    const start = storedChunkOffset(first)
    const end =
      last === lastChunk ? layout.storedLength : storedChunkOffset(last + 1)
    options.onRequest?.(end - start)
    let response: Response
    try {
      response = await input.fetch(
        count ? `${input.url}?download=true` : input.url,
        {
          headers: { Range: `bytes=${start}-${end - 1}` },
          signal: options.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        }
      )
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new SourceError('network')
    }
    if (response.status === 206) {
      const range = contentRange(response.headers.get('content-range'))
      // A different total means a different file than the page opened.
      if (
        !range ||
        range.start !== start ||
        range.end !== end - 1 ||
        range.total !== layout.storedLength
      ) {
        void response.body?.cancel().catch(() => undefined)
        throw new SourceError('changed')
      }
    } else if (!(
      response.status === 200 &&
      start === 0 &&
      end === layout.storedLength
    )) {
      void response.body?.cancel().catch(() => undefined)
      // A whole file in place of a range is a server that ignores `Range`.
      throw new SourceError(
        response.ok ? 'changed' : 'refused',
        response.status
      )
    }
    if (!response.body) throw new SourceError('network')
    return response.body
  }

  /** The verified plaintext of the chunks `first` to `last`, one at a time. */
  async function* chunks(
    first: number,
    last: number,
    options: StreamOptions
  ): AsyncGenerator<{ index: number; plaintext: Uint8Array }, void, undefined> {
    const window = options.window ?? 'adaptive'
    let size =
      window === 'whole'
        ? Infinity
        : window === 'adaptive'
          ? ADAPTIVE_FIRST_CHUNKS
          : Math.max(1, Math.floor(window))
    let counted = !options.countDownload
    for (let next = first; next <= last;) {
      const until = Math.min(last, next + size - 1)
      const body = await request(next, until, options, !counted)
      counted = true
      const reader = body.getReader()
      const pieces = new Pieces()
      let finished = false
      try {
        for (;;) {
          let step: ReadableStreamReadResult<Uint8Array>
          try {
            step = await reader.read()
          } catch (error) {
            if (options.signal?.aborted) throw error
            throw new SourceError('network')
          }
          if (step.done) break
          pieces.push(step.value)
          while (next <= until && pieces.length >= storedLengthOfChunk(next)) {
            const stored = pieces.take(storedLengthOfChunk(next))
            const plaintext = decryptChunk(
              keys(),
              next,
              next === lastChunk,
              stored
            )
            const index = next++
            yield { index, plaintext }
          }
        }
        // The answer ended before the range it promised, or ran past it.
        if (next <= until) throw new SourceError('network')
        if (pieces.length) throw new SourceError('changed')
        finished = true
      } finally {
        if (!finished) void reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
      if (window === 'adaptive') size = Math.min(size * 2, ADAPTIVE_MAX_CHUNKS)
    }
  }

  function checkRange(start: number, end: number) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      end > layout.plaintextLength
    )
      throw new E2eeError(
        'invalid_range',
        'The plaintext range is outside the file'
      )
  }

  async function* stream(
    start: number,
    end: number,
    options: StreamOptions = {}
  ): AsyncGenerator<Uint8Array, void, undefined> {
    checkRange(start, end)
    if (start === end) return
    const first = Math.floor(start / CHUNK_SIZE)
    const last = Math.floor((end - 1) / CHUNK_SIZE)
    for await (const { index, plaintext } of chunks(first, last, options)) {
      const chunkStart = index * CHUNK_SIZE
      const from = Math.max(start, chunkStart) - chunkStart
      const to = Math.min(end, chunkStart + plaintext.length) - chunkStart
      // A chunk that is shorter than the layout says cannot fill the range.
      if (to <= from) throw new E2eeError('truncated', 'A chunk is too short')
      yield from === 0 && to === plaintext.length
        ? plaintext
        : plaintext.subarray(from, to)
    }
  }

  return {
    layout,
    plaintextLength: layout.plaintextLength,
    verifyEnd(signal) {
      endVerified ??= (async () => {
        for await (const { plaintext } of chunks(lastChunk, lastChunk, {
          window: 1,
          signal,
        }))
          wipe(plaintext)
      })().catch((error: unknown) => {
        // Only a proof is kept. A failed request can be tried again.
        endVerified = null
        throw error
      })
      return endVerified
    },
    async read(start, end, signal) {
      checkRange(start, end)
      const out = new Uint8Array(end - start)
      let written = 0
      for await (const piece of stream(start, end, {
        window: 'whole',
        signal,
      })) {
        out.set(piece, written)
        written += piece.length
      }
      if (written !== out.length)
        throw new E2eeError('truncated', 'The range is not complete')
      return out
    },
    stream,
    close() {
      if (context) wipeContentContext(context)
      context = null
    },
  }
}
