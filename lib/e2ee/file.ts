import { CONTEXTS } from './contexts'
import { E2eeError } from './errors'
import {
  HASH_LENGTH,
  asciiBytes,
  blake3Hash,
  blake3KeyedHash,
  concatBytes,
  constantTimeEqual,
  deriveKey,
  le64,
  wipe,
  xchacha20Xor,
} from './primitives'
import {
  type ContentCipherKey,
  type ContentMacKey,
  type FileHeader,
  type FileKey,
  type HeaderHash,
  type LinkSecretKey,
  type MetadataKey,
  type NoncePrefix,
  type OcrTextKey,
  type ThumbnailKey,
  asFileKey,
  asNoncePrefix,
} from './types'

/**
 * File encryption of section 7: keys, header, chunks, streams and ranges.
 *
 * Streaming uses async iterables, not `TransformStream`. An async generator
 * runs unchanged in a browser, a worker, a service worker and Node.js, the
 * consumer controls the pace by pulling, and a failed tag is an exception at
 * the `for await` that reads the plaintext, so the caller cannot miss it.
 * `readableStreamChunks` adapts a `ReadableStream`, and
 * `ReadableStream.from` adapts the other way where a platform has it.
 */

// --- Layout constants (sections 7.2 and 7.3) ---

export const HEADER_MAGIC = 'FLAREE2E'
export const FORMAT_VERSION = 0x01
export const CHUNK_SIZE_LOG2 = 16
export const HEADER_LENGTH = 26
export const NONCE_PREFIX_LENGTH = 16
/** Plaintext bytes in each chunk but the last. */
export const CHUNK_SIZE = 65536
export const CHUNK_TAG_LENGTH = HASH_LENGTH
/** Stored bytes of each chunk but the last. */
export const STORED_CHUNK_SIZE = CHUNK_SIZE + CHUNK_TAG_LENGTH

const MAGIC_BYTES = asciiBytes(HEADER_MAGIC)

// --- File keys (sections 7.1, 8.2, 9.6.1 and 12.1) ---

export function deriveContentCipherKey(fileKey: FileKey): ContentCipherKey {
  return deriveKey(CONTEXTS.contentCipher, asFileKey(fileKey))
}

export function deriveContentMacKey(fileKey: FileKey): ContentMacKey {
  return deriveKey(CONTEXTS.contentMac, asFileKey(fileKey))
}

export function deriveMetadataKey(fileKey: FileKey): MetadataKey {
  return deriveKey(CONTEXTS.fileMetadata, asFileKey(fileKey))
}

export function deriveOcrTextKey(fileKey: FileKey): OcrTextKey {
  return deriveKey(CONTEXTS.ocrText, asFileKey(fileKey))
}

export function deriveThumbnailKey(fileKey: FileKey): ThumbnailKey {
  return deriveKey(CONTEXTS.thumbnail, asFileKey(fileKey))
}

export function deriveLinkSecretKey(fileKey: FileKey): LinkSecretKey {
  return deriveKey(CONTEXTS.linkSecretCopy, asFileKey(fileKey))
}

export interface FileKeys {
  readonly contentCipherKey: ContentCipherKey
  readonly contentMacKey: ContentMacKey
  readonly metadataKey: MetadataKey
  readonly ocrTextKey: OcrTextKey
  readonly thumbnailKey: ThumbnailKey
  readonly linkSecretKey: LinkSecretKey
}

/** Every key that comes from one `file_key`. */
export function deriveFileKeys(fileKey: FileKey): FileKeys {
  return {
    contentCipherKey: deriveContentCipherKey(fileKey),
    contentMacKey: deriveContentMacKey(fileKey),
    metadataKey: deriveMetadataKey(fileKey),
    ocrTextKey: deriveOcrTextKey(fileKey),
    thumbnailKey: deriveThumbnailKey(fileKey),
    linkSecretKey: deriveLinkSecretKey(fileKey),
  }
}

// --- Header (section 7.2) ---

/** `magic || format_version || chunk_size_log2 || nonce_prefix`, 26 bytes. */
export function buildHeader(noncePrefix: NoncePrefix): FileHeader {
  asNoncePrefix(noncePrefix)
  return concatBytes(
    MAGIC_BYTES,
    Uint8Array.of(FORMAT_VERSION, CHUNK_SIZE_LOG2),
    noncePrefix
  ) as FileHeader
}

export interface ParsedHeader {
  readonly header: FileHeader
  readonly headerHash: HeaderHash
  readonly noncePrefix: NoncePrefix
}

/**
 * Steps 1 and 2 of section 7.4. An unknown `format_version` stops with
 * `unknown_version`: the client must not try other rules (section 1.5.2).
 */
export function parseHeader(header: Uint8Array): ParsedHeader {
  if (header.length !== HEADER_LENGTH) {
    throw new E2eeError(
      header.length < HEADER_LENGTH ? 'truncated' : 'bad_length',
      `A file header has ${HEADER_LENGTH} bytes, got ${header.length}`
    )
  }
  if (!constantTimeEqual(header.subarray(0, 8), MAGIC_BYTES)) {
    throw new E2eeError('bad_magic', 'The file does not start with FLAREE2E')
  }
  if (header[8] !== FORMAT_VERSION) {
    throw new E2eeError(
      'unknown_version',
      `Unknown format_version ${header[8]}. Update the client.`
    )
  }
  if (header[9] !== CHUNK_SIZE_LOG2) {
    throw new E2eeError(
      'unsupported_chunk_size',
      `Unsupported chunk_size_log2 ${header[9]}`
    )
  }
  const copy = header.slice() as FileHeader
  return {
    header: copy,
    headerHash: blake3Hash(copy) as HeaderHash,
    noncePrefix: copy.slice(10) as NoncePrefix,
  }
}

/** `header_hash = blake3_hash(header)`, after the checks of `parseHeader`. */
export function headerHash(header: Uint8Array): HeaderHash {
  return parseHeader(header).headerHash
}

// --- Chunks (sections 7.3 and 7.4) ---

/** What the chunk functions need for one file. Make it with `contentContext`. */
export interface ContentContext {
  readonly contentCipherKey: ContentCipherKey
  readonly contentMacKey: ContentMacKey
  readonly headerHash: HeaderHash
  readonly noncePrefix: NoncePrefix
}

export function contentContext(
  fileKey: FileKey,
  header: Uint8Array
): ContentContext {
  const parsed = parseHeader(header)
  return {
    contentCipherKey: deriveContentCipherKey(fileKey),
    contentMacKey: deriveContentMacKey(fileKey),
    headerHash: parsed.headerHash,
    noncePrefix: parsed.noncePrefix,
  }
}

/** Erases the two content keys of a context that is no longer needed. */
export function wipeContentContext(context: ContentContext): void {
  wipe(context.contentCipherKey, context.contentMacKey)
}

function chunkTag(
  context: ContentContext,
  chunkIndexLe: Uint8Array,
  isFinal: boolean,
  chunkCiphertext: Uint8Array
): Uint8Array {
  return blake3KeyedHash(
    context.contentMacKey,
    context.headerHash,
    chunkIndexLe,
    Uint8Array.of(isFinal ? 0x01 : 0x00),
    chunkCiphertext
  )
}

/**
 * Steps 1 to 5 of section 7.3 for one chunk, with no rule about the chunk
 * length. Writers use `encryptChunk`, which adds the length rules. This one
 * exists so a test vector can fix a chunk of any length.
 */
export function encryptChunkUnchecked(
  context: ContentContext,
  chunkIndex: number,
  isFinal: boolean,
  chunkPlaintext: Uint8Array
): Uint8Array {
  const chunkIndexLe = le64(chunkIndex)
  const chunkNonce = concatBytes(context.noncePrefix, chunkIndexLe)
  const chunkCiphertext = xchacha20Xor(
    context.contentCipherKey,
    chunkNonce,
    chunkPlaintext
  )
  const tag = chunkTag(context, chunkIndexLe, isFinal, chunkCiphertext)
  return concatBytes(chunkCiphertext, tag)
}

/**
 * Encrypts one chunk. A chunk that is not the last one must have exactly
 * 65536 bytes. The last one has 1 to 65536 bytes, or 0 bytes if the file is
 * empty.
 */
export function encryptChunk(
  context: ContentContext,
  chunkIndex: number,
  isFinal: boolean,
  chunkPlaintext: Uint8Array
): Uint8Array {
  const length = chunkPlaintext.length
  const valid = isFinal
    ? length <= CHUNK_SIZE && (length > 0 || chunkIndex === 0)
    : length === CHUNK_SIZE
  if (!valid) {
    throw new E2eeError(
      'bad_length',
      `A ${isFinal ? 'final' : 'non-final'} chunk cannot have ${length} plaintext bytes`
    )
  }
  return encryptChunkUnchecked(context, chunkIndex, isFinal, chunkPlaintext)
}

type ChunkCheck = 'ok' | 'bad_length' | 'truncated' | 'tag_mismatch'

function checkStoredChunk(
  context: ContentContext,
  chunkIndexLe: Uint8Array,
  isFinal: boolean,
  storedChunk: Uint8Array
): ChunkCheck {
  if (storedChunk.length < CHUNK_TAG_LENGTH) return 'truncated'
  if (
    isFinal
      ? storedChunk.length > STORED_CHUNK_SIZE
      : storedChunk.length !== STORED_CHUNK_SIZE
  ) {
    return 'bad_length'
  }
  const split = storedChunk.length - CHUNK_TAG_LENGTH
  const expected = chunkTag(
    context,
    chunkIndexLe,
    isFinal,
    storedChunk.subarray(0, split)
  )
  return constantTimeEqual(expected, storedChunk.subarray(split))
    ? 'ok'
    : 'tag_mismatch'
}

/**
 * Verifies and decrypts one stored chunk (section 7.4, steps 3, 4 and 6).
 * The cipher does not run before the tag is correct, so no unverified
 * plaintext exists. `isFinal` is the caller's knowledge of the position: a
 * chunk that was stored as final does not verify as non-final, and the
 * reverse.
 */
export function decryptChunk(
  context: ContentContext,
  chunkIndex: number,
  isFinal: boolean,
  storedChunk: Uint8Array
): Uint8Array {
  const chunkIndexLe = le64(chunkIndex)
  const check = checkStoredChunk(context, chunkIndexLe, isFinal, storedChunk)
  if (check !== 'ok') {
    throw new E2eeError(check, chunkFailureMessage(check, chunkIndex, isFinal))
  }
  return xchacha20Xor(
    context.contentCipherKey,
    concatBytes(context.noncePrefix, chunkIndexLe),
    storedChunk.subarray(0, storedChunk.length - CHUNK_TAG_LENGTH)
  )
}

function chunkFailureMessage(
  check: Exclude<ChunkCheck, 'ok'>,
  chunkIndex: number,
  isFinal: boolean
): string {
  if (check === 'tag_mismatch') {
    return `Chunk ${chunkIndex} did not authenticate`
  }
  if (check === 'truncated') {
    return `Chunk ${chunkIndex} is shorter than its tag`
  }
  return isFinal
    ? `The final chunk ${chunkIndex} is longer than ${STORED_CHUNK_SIZE} bytes`
    : `Chunk ${chunkIndex} is not final and does not have ${STORED_CHUNK_SIZE} stored bytes`
}

// --- Streams ---

export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>

/** Reads a `ReadableStream` as an async iterable, also where the stream has no `Symbol.asyncIterator`. */
export async function* readableStreamChunks(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/** A queue of byte arrays that gives back exact lengths. */
class ByteQueue {
  private parts: Uint8Array[] = []
  private headOffset = 0
  length = 0

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    this.parts.push(bytes)
    this.length += bytes.length
  }

  /** Removes and returns the first `count` bytes as a new array. */
  take(count: number): Uint8Array {
    const out = new Uint8Array(count)
    let written = 0
    while (written < count) {
      const head = this.parts[0]
      const available = head.length - this.headOffset
      const wanted = Math.min(available, count - written)
      out.set(head.subarray(this.headOffset, this.headOffset + wanted), written)
      written += wanted
      if (wanted === available) {
        this.parts.shift()
        this.headOffset = 0
      } else {
        this.headOffset += wanted
      }
    }
    this.length -= count
    return out
  }
}

/**
 * Encrypts a file as a stream. Yields the 26-byte header first, then one
 * stored chunk at a time. The source can have pieces of any size.
 *
 * A full chunk is held back until one more byte arrives, because only then
 * is it known not to be the last one. Memory use is at most two chunks plus
 * one source piece.
 */
export async function* encryptFile(
  fileKey: FileKey,
  noncePrefix: NoncePrefix,
  plaintext: ByteSource
): AsyncGenerator<Uint8Array, void, undefined> {
  const header = buildHeader(noncePrefix)
  const context = contentContext(fileKey, header)
  try {
    yield header.slice()
    const queue = new ByteQueue()
    let chunkIndex = 0
    for await (const piece of plaintext) {
      queue.push(piece)
      while (queue.length > CHUNK_SIZE) {
        const chunk = queue.take(CHUNK_SIZE)
        yield encryptChunk(context, chunkIndex++, false, chunk)
        wipe(chunk)
      }
    }
    const last = queue.take(queue.length)
    yield encryptChunk(context, chunkIndex, true, last)
    wipe(last)
  } finally {
    wipeContentContext(context)
  }
}

/**
 * Decrypts a stored file as a stream and enforces every rule of section
 * 7.4. Yields the plaintext of a chunk only after its tag is correct. The
 * source can have pieces of any size.
 *
 * The consumer must treat the output as incomplete until the generator
 * returns: a truncated file fails at its end, after the earlier chunks were
 * given out. Each given byte is authentic for its position.
 *
 * Failure reasons: `truncated` if the input ends before a final chunk,
 * `trailing_data` if bytes follow the final chunk, `tag_mismatch` for each
 * other change. A short chunk before the end shifts every later byte, so it
 * shows as `tag_mismatch`.
 */
export async function* decryptFile(
  fileKey: FileKey,
  stored: ByteSource
): AsyncGenerator<Uint8Array, void, undefined> {
  asFileKey(fileKey)
  const queue = new ByteQueue()
  let context: ContentContext | undefined
  let chunkIndex = 0
  try {
    for await (const piece of stored) {
      queue.push(piece)
      if (!context) {
        if (queue.length < HEADER_LENGTH) continue
        context = contentContext(fileKey, queue.take(HEADER_LENGTH))
      }
      // More bytes exist after the first STORED_CHUNK_SIZE of the queue, so
      // that chunk is not the last one.
      while (queue.length > STORED_CHUNK_SIZE) {
        const storedChunk = queue.take(STORED_CHUNK_SIZE)
        const plaintext = decryptStreamChunk(
          context,
          chunkIndex++,
          false,
          storedChunk
        )
        yield plaintext
      }
    }
    if (!context) {
      throw new E2eeError('truncated', 'The file ends inside its header')
    }
    if (queue.length === 0) {
      // Only possible with zero chunks: an empty file still has one chunk.
      throw new E2eeError('truncated', 'The file has no final chunk')
    }
    const last = decryptStreamChunk(
      context,
      chunkIndex,
      true,
      queue.take(queue.length)
    )
    if (last.length > 0) yield last
  } finally {
    if (context) wipeContentContext(context)
  }
}

/**
 * `decryptChunk` for a position that the stream inferred. If the tag fails,
 * one more tag calculation with the other `final_flag` tells a truncation or
 * trailing data from a changed chunk. No plaintext is made on that path.
 */
function decryptStreamChunk(
  context: ContentContext,
  chunkIndex: number,
  isFinal: boolean,
  storedChunk: Uint8Array
): Uint8Array {
  const chunkIndexLe = le64(chunkIndex)
  const check = checkStoredChunk(context, chunkIndexLe, isFinal, storedChunk)
  if (check === 'tag_mismatch') {
    const other = checkStoredChunk(context, chunkIndexLe, !isFinal, storedChunk)
    if (other === 'ok') {
      throw isFinal
        ? new E2eeError(
            'truncated',
            `The file ends after chunk ${chunkIndex}, which is not the final chunk`
          )
        : new E2eeError(
            'trailing_data',
            `Data follows the final chunk ${chunkIndex}`
          )
    }
  }
  return decryptChunk(context, chunkIndex, isFinal, storedChunk)
}

// --- Ranges (sections 7.5 and 12.2) ---

export interface FileLayout {
  readonly storedLength: number
  readonly plaintextLength: number
  readonly chunkCount: number
  /** Stored bytes of the last chunk, tag included. */
  readonly finalStoredChunkLength: number
}

/** The stored length of a file with `plaintextLength` bytes. */
export function storedLengthOf(plaintextLength: number): number {
  if (!Number.isSafeInteger(plaintextLength) || plaintextLength < 0) {
    throw new E2eeError('invalid_argument', 'Not a valid plaintext length')
  }
  const chunkCount = Math.max(1, Math.ceil(plaintextLength / CHUNK_SIZE))
  return HEADER_LENGTH + plaintextLength + chunkCount * CHUNK_TAG_LENGTH
}

/**
 * The chunk layout that a stored length implies. The server reports the
 * stored length, so it is not trusted: a wrong value makes a tag fail later,
 * because the final chunk is then at a different position.
 */
export function fileLayout(storedLength: number): FileLayout {
  if (!Number.isSafeInteger(storedLength) || storedLength < 0) {
    throw new E2eeError('invalid_argument', 'Not a valid stored length')
  }
  const body = storedLength - HEADER_LENGTH
  if (body < CHUNK_TAG_LENGTH) {
    throw new E2eeError(
      'truncated',
      'The stored file is shorter than a header and one chunk'
    )
  }
  const remainder = body % STORED_CHUNK_SIZE
  if (remainder !== 0 && remainder < CHUNK_TAG_LENGTH) {
    throw new E2eeError(
      'truncated',
      'The last stored chunk is shorter than its tag'
    )
  }
  const chunkCount = Math.ceil(body / STORED_CHUNK_SIZE)
  return {
    storedLength,
    plaintextLength: body - chunkCount * CHUNK_TAG_LENGTH,
    chunkCount,
    finalStoredChunkLength: remainder === 0 ? STORED_CHUNK_SIZE : remainder,
  }
}

/** Offset of a stored chunk in the stored file: `26 + chunk_index * 65568`. */
export function storedChunkOffset(chunkIndex: number): number {
  return HEADER_LENGTH + chunkIndex * STORED_CHUNK_SIZE
}

export interface StoredRange {
  readonly firstChunkIndex: number
  readonly lastChunkIndex: number
  /** First stored byte to fetch. */
  readonly storedStart: number
  /** One past the last stored byte to fetch. An HTTP `Range` header ends at `storedEnd - 1`. */
  readonly storedEnd: number
  readonly layout: FileLayout
}

/**
 * Maps the plaintext bytes `[start, end)` to the stored bytes of the chunks
 * that contain them.
 */
export function storedRangeForPlaintextRange(
  storedLength: number,
  start: number,
  end: number
): StoredRange {
  const layout = fileLayout(storedLength)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > layout.plaintextLength
  ) {
    throw new E2eeError(
      'invalid_range',
      'The plaintext range is empty or outside the file'
    )
  }
  const firstChunkIndex = Math.floor(start / CHUNK_SIZE)
  const lastChunkIndex = Math.floor((end - 1) / CHUNK_SIZE)
  return {
    firstChunkIndex,
    lastChunkIndex,
    storedStart: storedChunkOffset(firstChunkIndex),
    storedEnd:
      lastChunkIndex === layout.chunkCount - 1
        ? storedLength
        : storedChunkOffset(lastChunkIndex + 1),
    layout,
  }
}

/**
 * Decrypts the plaintext bytes `[start, end)`. `storedBytes` must be exactly
 * the stored bytes `[storedStart, storedEnd)` of
 * `storedRangeForPlaintextRange`. Every fetched chunk is verified before any
 * byte is returned.
 */
export function decryptRange(input: {
  readonly context: ContentContext
  readonly storedLength: number
  readonly start: number
  readonly end: number
  readonly storedBytes: Uint8Array
}): Uint8Array {
  const { context, start, end, storedBytes } = input
  const range = storedRangeForPlaintextRange(input.storedLength, start, end)
  const expectedLength = range.storedEnd - range.storedStart
  if (storedBytes.length !== expectedLength) {
    throw new E2eeError(
      storedBytes.length < expectedLength ? 'truncated' : 'trailing_data',
      `The range needs ${expectedLength} stored bytes, got ${storedBytes.length}`
    )
  }
  const chunks: Uint8Array[] = []
  for (
    let chunkIndex = range.firstChunkIndex;
    chunkIndex <= range.lastChunkIndex;
    chunkIndex++
  ) {
    const offset = (chunkIndex - range.firstChunkIndex) * STORED_CHUNK_SIZE
    const isFinal = chunkIndex === range.layout.chunkCount - 1
    const length = isFinal
      ? range.layout.finalStoredChunkLength
      : STORED_CHUNK_SIZE
    chunks.push(
      decryptChunk(
        context,
        chunkIndex,
        isFinal,
        storedBytes.subarray(offset, offset + length)
      )
    )
  }
  const out = new Uint8Array(end - start)
  let written = 0
  for (let index = 0; index < chunks.length; index++) {
    const chunkStart = (range.firstChunkIndex + index) * CHUNK_SIZE
    const from = Math.max(start, chunkStart) - chunkStart
    const to = Math.min(end, chunkStart + chunks[index].length) - chunkStart
    out.set(chunks[index].subarray(from, to), written)
    written += to - from
    wipe(chunks[index])
  }
  return out
}
