import { describe, expect, it } from 'vitest'

import { CONTEXTS } from './contexts'
import { E2eeError } from './errors'
import {
  CHUNK_SIZE,
  HEADER_LENGTH,
  STORED_CHUNK_SIZE,
  buildHeader,
  contentContext,
  decryptChunk,
  decryptFile,
  decryptRange,
  deriveFileKeys,
  encryptChunk,
  encryptFile,
  fileLayout,
  headerHash,
  parseHeader,
  readableStreamChunks,
  storedChunkOffset,
  storedLengthOf,
  storedRangeForPlaintextRange,
} from './file'
import {
  blake3DeriveKey,
  blake3Hash,
  blake3KeyedHash,
  bytesToHex,
  concatBytes,
  le64,
  xchacha20Xor,
} from './primitives'
import {
  collect,
  expectReason,
  expectReasonAsync,
  flipBit,
  mod251,
  pattern,
  pieces,
} from './test-support'
import { encryptChunkUnchecked } from './testing'
import { asFileKey, asNoncePrefix } from './types'

const fileKey = asFileKey(pattern(32, 21))
const noncePrefix = asNoncePrefix(pattern(16, 22))
const header = buildHeader(noncePrefix)
const context = contentContext(fileKey, header)

const SIZES = [0, 1, 65535, 65536, 65537, 131072, 200000]

async function encryptAll(
  plaintext: Uint8Array,
  key = fileKey,
  prefix = noncePrefix
): Promise<Uint8Array> {
  return collect(encryptFile(key, prefix, [plaintext]))
}

function decryptAll(stored: Uint8Array, key = fileKey): Promise<Uint8Array> {
  return collect(decryptFile(key, [stored]))
}

/** Runs a decryption to its failure and returns what was released before it. */
async function releasedBeforeFailure(stored: Uint8Array) {
  const released: Uint8Array[] = []
  let error: unknown
  try {
    for await (const part of decryptFile(fileKey, [stored])) {
      released.push(part)
    }
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(E2eeError)
  return {
    reason: (error as E2eeError).reason,
    released: concatBytes(...released),
  }
}

describe('file keys', () => {
  it('derives each key with its own context', () => {
    const keys = deriveFileKeys(fileKey)
    expect(keys.contentCipherKey).toEqual(
      blake3DeriveKey(CONTEXTS.contentCipher, fileKey)
    )
    expect(keys.contentMacKey).toEqual(
      blake3DeriveKey(CONTEXTS.contentMac, fileKey)
    )
    expect(keys.metadataKey).toEqual(
      blake3DeriveKey(CONTEXTS.fileMetadata, fileKey)
    )
    expect(keys.ocrTextKey).toEqual(blake3DeriveKey(CONTEXTS.ocrText, fileKey))
    expect(keys.thumbnailKey).toEqual(
      blake3DeriveKey(CONTEXTS.thumbnail, fileKey)
    )
    expect(keys.linkSecretKey).toEqual(
      blake3DeriveKey(CONTEXTS.linkSecretCopy, fileKey)
    )
    const distinct = new Set(Object.values(keys).map(bytesToHex))
    expect(distinct.size).toBe(6)
  })
})

describe('header', () => {
  it('has 26 bytes: magic, version, chunk size, nonce prefix', () => {
    expect(header).toHaveLength(26)
    expect(bytesToHex(header)).toBe(
      '464c41524545324501' + '10' + bytesToHex(noncePrefix)
    )
    const parsed = parseHeader(header)
    expect(parsed.noncePrefix).toEqual(noncePrefix)
    expect(parsed.headerHash).toEqual(blake3Hash(header))
    expect(headerHash(header)).toEqual(blake3Hash(header))
  })

  it('rejects a wrong magic, version, chunk size or length', () => {
    expectReason(() => parseHeader(flipBit(header, 0)), 'bad_magic')
    expectReason(() => parseHeader(flipBit(header, 7)), 'bad_magic')
    const version2 = header.slice()
    version2[8] = 2
    expectReason(() => parseHeader(version2), 'unknown_version')
    const version0 = header.slice()
    version0[8] = 0
    expectReason(() => parseHeader(version0), 'unknown_version')
    const chunk17 = header.slice()
    chunk17[9] = 17
    expectReason(() => parseHeader(chunk17), 'unsupported_chunk_size')
    expectReason(() => parseHeader(header.subarray(0, 25)), 'truncated')
    expectReason(
      () => parseHeader(concatBytes(header, Uint8Array.of(0))),
      'bad_length'
    )
    expectReason(
      () => buildHeader(asNoncePrefix(pattern(16)).subarray(1) as never),
      'bad_length'
    )
  })
})

describe('chunks', () => {
  it('builds a stored chunk as section 7.3 says', () => {
    const plaintext = pattern(100, 3)
    const keys = deriveFileKeys(fileKey)
    const ciphertext = xchacha20Xor(
      keys.contentCipherKey,
      concatBytes(noncePrefix, le64(5)),
      plaintext
    )
    const tag = blake3KeyedHash(
      keys.contentMacKey,
      concatBytes(blake3Hash(header), le64(5), Uint8Array.of(1), ciphertext)
    )
    expect(encryptChunk(context, 5, true, plaintext)).toEqual(
      concatBytes(ciphertext, tag)
    )
    const full = pattern(CHUNK_SIZE, 4)
    const fullCiphertext = xchacha20Xor(
      keys.contentCipherKey,
      concatBytes(noncePrefix, le64(0)),
      full
    )
    expect(encryptChunk(context, 0, false, full)).toEqual(
      concatBytes(
        fullCiphertext,
        blake3KeyedHash(
          keys.contentMacKey,
          concatBytes(
            blake3Hash(header),
            le64(0),
            Uint8Array.of(0),
            fullCiphertext
          )
        )
      )
    )
  })

  it('round-trips, and binds the index, the final flag, the header and the key', () => {
    const plaintext = pattern(CHUNK_SIZE, 6)
    const stored = encryptChunk(context, 3, false, plaintext)
    expect(stored).toHaveLength(STORED_CHUNK_SIZE)
    expect(decryptChunk(context, 3, false, stored)).toEqual(plaintext)
    expectReason(() => decryptChunk(context, 2, false, stored), 'tag_mismatch')
    expectReason(() => decryptChunk(context, 3, true, stored), 'tag_mismatch')
    const otherHeader = contentContext(
      fileKey,
      buildHeader(asNoncePrefix(pattern(16, 23)))
    )
    expectReason(
      () => decryptChunk(otherHeader, 3, false, stored),
      'tag_mismatch'
    )
    // Same nonce prefix, different header hash: only the tag input differs.
    expectReason(
      () =>
        decryptChunk(
          { ...context, headerHash: blake3Hash(pattern(26)) as never },
          3,
          false,
          stored
        ),
      'tag_mismatch'
    )
    const otherKey = contentContext(asFileKey(pattern(32, 24)), header)
    expectReason(() => decryptChunk(otherKey, 3, false, stored), 'tag_mismatch')
  })

  it('rejects a flipped bit in the ciphertext and in the tag', () => {
    const stored = encryptChunk(context, 0, true, pattern(300, 6))
    for (let index = 0; index < stored.length; index++) {
      expectReason(
        () => decryptChunk(context, 0, true, flipBit(stored, index)),
        'tag_mismatch'
      )
    }
  })

  it('enforces the chunk lengths on both sides', () => {
    // A chunk that is not the last one must have exactly 65536 bytes.
    expectReason(
      () => encryptChunk(context, 0, false, pattern(CHUNK_SIZE - 1)),
      'bad_length'
    )
    expectReason(
      () => encryptChunk(context, 0, true, pattern(CHUNK_SIZE + 1)),
      'bad_length'
    )
    expectReason(
      () => encryptChunk(context, 1, true, new Uint8Array(0)),
      'bad_length'
    )
    // An authentic short chunk that is marked non-final is still rejected.
    const shortNonFinal = encryptChunkUnchecked(context, 0, false, pattern(10))
    expectReason(
      () => decryptChunk(context, 0, false, shortNonFinal),
      'bad_length'
    )
    const longFinal = encryptChunkUnchecked(
      context,
      0,
      true,
      pattern(CHUNK_SIZE + 1)
    )
    expectReason(() => decryptChunk(context, 0, true, longFinal), 'bad_length')
    expectReason(
      () => decryptChunk(context, 0, true, new Uint8Array(31)),
      'truncated'
    )
  })
})

describe('file stream', () => {
  it.each(SIZES)('round-trips %i plaintext bytes', async (length) => {
    const plaintext = mod251(length)
    const stored = await encryptAll(plaintext)
    expect(stored).toHaveLength(storedLengthOf(length))
    expect(stored.subarray(0, HEADER_LENGTH)).toEqual(header)
    expect(await decryptAll(stored)).toEqual(plaintext)
    expect(fileLayout(stored.length).plaintextLength).toBe(length)
  })

  it('does not depend on how the source is cut', async () => {
    const plaintext = mod251(200000)
    const whole = await encryptAll(plaintext)
    for (const sizes of [
      [1000],
      [65536],
      [65535, 2],
      [70000, 1, 3],
      [200000],
    ]) {
      const stored = await collect(
        encryptFile(fileKey, noncePrefix, pieces(plaintext, sizes))
      )
      expect(stored).toEqual(whole)
      const decrypted = await collect(
        decryptFile(fileKey, pieces(stored, sizes))
      )
      expect(decrypted).toEqual(plaintext)
    }
    const fromAsync = await collect(
      encryptFile(
        fileKey,
        noncePrefix,
        (async function* () {
          yield* pieces(plaintext, [4096])
        })()
      )
    )
    expect(fromAsync).toEqual(whole)
  })

  it('reads a ReadableStream', async () => {
    const plaintext = mod251(70000)
    const stored = await encryptAll(plaintext)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces(stored, [30000])) controller.enqueue(piece)
        controller.close()
      },
    })
    expect(
      await collect(decryptFile(fileKey, readableStreamChunks(stream)))
    ).toEqual(plaintext)
  })

  it('writes one chunk of length zero for an empty file', async () => {
    const stored = await encryptAll(new Uint8Array(0))
    expect(stored).toHaveLength(26 + 32)
    expect(stored.subarray(26)).toEqual(
      encryptChunk(context, 0, true, new Uint8Array(0))
    )
  })

  it('writes a full last chunk as final, without an empty chunk after it', async () => {
    const plaintext = mod251(CHUNK_SIZE * 2)
    const stored = await encryptAll(plaintext)
    expect(stored).toHaveLength(26 + 2 * STORED_CHUNK_SIZE)
    expect(stored.subarray(26 + STORED_CHUNK_SIZE)).toEqual(
      encryptChunk(context, 1, true, plaintext.subarray(CHUNK_SIZE))
    )
  })

  it('rejects a wrong key', async () => {
    const stored = await encryptAll(mod251(1000))
    await expectReasonAsync(
      () => decryptAll(stored, asFileKey(pattern(32, 25))),
      'tag_mismatch'
    )
  })

  it('rejects a flipped bit anywhere in a small file', async () => {
    const stored = await encryptAll(mod251(40))
    for (let index = 0; index < stored.length; index++) {
      const changed = flipBit(stored, index)
      const expected =
        index < 8
          ? 'bad_magic'
          : index === 8
            ? 'unknown_version'
            : index === 9
              ? 'unsupported_chunk_size'
              : 'tag_mismatch'
      await expectReasonAsync(() => decryptAll(changed), expected)
    }
  })

  it('rejects a flipped bit in each chunk and releases only the chunks before it', async () => {
    const plaintext = mod251(200000)
    const stored = await encryptAll(plaintext)
    const positions = [
      [storedChunkOffset(0) + 100, 0],
      [storedChunkOffset(1) - 1, 0],
      [storedChunkOffset(1) + 5, 1],
      [storedChunkOffset(2) - 32, 1],
      [storedChunkOffset(3) + 1, 3],
      [stored.length - 1, 3],
    ]
    for (const [position, failingChunk] of positions) {
      const result = await releasedBeforeFailure(flipBit(stored, position))
      expect(result.reason).toBe('tag_mismatch')
      // No byte of the failing chunk or of a later chunk is released.
      expect(result.released).toEqual(
        plaintext.subarray(0, failingChunk * CHUNK_SIZE)
      )
    }
  })

  it('rejects swapped chunks', async () => {
    const stored = await encryptAll(mod251(CHUNK_SIZE * 3))
    const chunk = (index: number) =>
      stored.subarray(storedChunkOffset(index), storedChunkOffset(index + 1))
    const swapped = concatBytes(header, chunk(1), chunk(0), chunk(2))
    const result = await releasedBeforeFailure(swapped)
    expect(result.reason).toBe('tag_mismatch')
    expect(result.released).toHaveLength(0)
    await expectReasonAsync(
      () => decryptAll(concatBytes(header, chunk(0), chunk(2), chunk(1))),
      'tag_mismatch'
    )
  })

  it('rejects a duplicated and a removed chunk', async () => {
    const stored = await encryptAll(mod251(CHUNK_SIZE * 3))
    const chunk = (index: number) =>
      stored.subarray(storedChunkOffset(index), storedChunkOffset(index + 1))
    await expectReasonAsync(
      () =>
        decryptAll(concatBytes(header, chunk(0), chunk(0), chunk(1), chunk(2))),
      'tag_mismatch'
    )
    await expectReasonAsync(
      () => decryptAll(concatBytes(header, chunk(0), chunk(2))),
      'tag_mismatch'
    )
  })

  it('rejects a truncation at a chunk boundary', async () => {
    const plaintext = mod251(200000)
    const stored = await encryptAll(plaintext)
    for (const keptChunks of [1, 2, 3]) {
      const result = await releasedBeforeFailure(
        stored.subarray(0, storedChunkOffset(keptChunks))
      )
      expect(result.reason).toBe('truncated')
      // The chunk that would have been the last one is not released.
      expect(result.released).toEqual(
        plaintext.subarray(0, (keptChunks - 1) * CHUNK_SIZE)
      )
    }
  })

  it('rejects a truncation inside a chunk, inside a tag and inside the header', async () => {
    const stored = await encryptAll(mod251(200000))
    await expectReasonAsync(
      () => decryptAll(stored.subarray(0, stored.length - 1)),
      'tag_mismatch'
    )
    await expectReasonAsync(
      () => decryptAll(stored.subarray(0, storedChunkOffset(1) + 500)),
      'tag_mismatch'
    )
    await expectReasonAsync(
      () => decryptAll(stored.subarray(0, storedChunkOffset(3) + 31)),
      'truncated'
    )
    await expectReasonAsync(
      () => decryptAll(stored.subarray(0, HEADER_LENGTH)),
      'truncated'
    )
    await expectReasonAsync(
      () => decryptAll(stored.subarray(0, 10)),
      'truncated'
    )
    await expectReasonAsync(() => decryptAll(new Uint8Array(0)), 'truncated')
  })

  it('rejects data after a full final chunk', async () => {
    const plaintext = mod251(CHUNK_SIZE * 2)
    const stored = await encryptAll(plaintext)
    for (const extra of [Uint8Array.of(0), pattern(32), pattern(70000)]) {
      const result = await releasedBeforeFailure(concatBytes(stored, extra))
      expect(result.reason).toBe('trailing_data')
      expect(result.released).toEqual(plaintext.subarray(0, CHUNK_SIZE))
    }
  })

  it('rejects data after a short final chunk', async () => {
    const plaintext = mod251(CHUNK_SIZE + 100)
    const stored = await encryptAll(plaintext)
    for (const extra of [Uint8Array.of(0), pattern(32), pattern(70000)]) {
      const result = await releasedBeforeFailure(concatBytes(stored, extra))
      expect(result.reason).toBe('tag_mismatch')
      expect(result.released).toEqual(plaintext.subarray(0, CHUNK_SIZE))
    }
  })

  it('rejects a second final chunk and a second file after the final chunk', async () => {
    const stored = await encryptAll(mod251(CHUNK_SIZE))
    const secondFinal = encryptChunk(context, 1, true, pattern(50))
    const withSecondFinal = await releasedBeforeFailure(
      concatBytes(stored, secondFinal)
    )
    expect(withSecondFinal.reason).toBe('trailing_data')
    expect(withSecondFinal.released).toHaveLength(0)
    await expectReasonAsync(
      () => decryptAll(concatBytes(stored, stored)),
      'trailing_data'
    )
  })

  it('rejects a short chunk that is not the last one', async () => {
    // Authentic chunks, but chunk 0 has 100 bytes and final_flag 0.
    const forged = concatBytes(
      header,
      encryptChunkUnchecked(context, 0, false, pattern(100)),
      encryptChunkUnchecked(context, 1, true, pattern(50))
    )
    const result = await releasedBeforeFailure(forged)
    expect(result.reason).toBe('tag_mismatch')
    expect(result.released).toHaveLength(0)
  })

  it('rejects a file of a different header with the same key', async () => {
    const stored = await encryptAll(mod251(1000))
    const otherHeader = buildHeader(asNoncePrefix(pattern(16, 30)))
    await expectReasonAsync(
      () => decryptAll(concatBytes(otherHeader, stored.subarray(26))),
      'tag_mismatch'
    )
  })

  it('reads a zero-length final chunk after full chunks (7.4 does not forbid it)', async () => {
    const plaintext = mod251(CHUNK_SIZE)
    const stored = concatBytes(
      header,
      encryptChunk(context, 0, false, plaintext),
      encryptChunkUnchecked(context, 1, true, new Uint8Array(0))
    )
    expect(await decryptAll(stored)).toEqual(plaintext)
    expect(fileLayout(stored.length).plaintextLength).toBe(CHUNK_SIZE)
  })
})

describe('byte ranges', () => {
  it('maps lengths in both directions', () => {
    for (const length of [...SIZES, 65536 * 3, 65536 * 3 + 1]) {
      const layout = fileLayout(storedLengthOf(length))
      expect(layout.plaintextLength).toBe(length)
      expect(layout.chunkCount).toBe(Math.max(1, Math.ceil(length / 65536)))
    }
    expect(storedLengthOf(0)).toBe(58)
    expect(storedLengthOf(65536)).toBe(26 + 65568)
    expect(storedLengthOf(65537)).toBe(26 + 65568 + 33)
    expect(storedChunkOffset(0)).toBe(26)
    expect(storedChunkOffset(2)).toBe(26 + 2 * 65568)
  })

  it('rejects impossible stored lengths', () => {
    expectReason(() => fileLayout(0), 'truncated')
    expectReason(() => fileLayout(57), 'truncated')
    expectReason(() => fileLayout(26 + 65568 + 31), 'truncated')
    expectReason(() => fileLayout(-1), 'invalid_argument')
    expectReason(() => fileLayout(1.5), 'invalid_argument')
  })

  it('maps a plaintext range to whole stored chunks', () => {
    const storedLength = storedLengthOf(200000)
    expect(storedRangeForPlaintextRange(storedLength, 0, 1)).toMatchObject({
      firstChunkIndex: 0,
      lastChunkIndex: 0,
      storedStart: 26,
      storedEnd: 26 + 65568,
    })
    expect(
      storedRangeForPlaintextRange(storedLength, 65535, 65537)
    ).toMatchObject({
      firstChunkIndex: 0,
      lastChunkIndex: 1,
      storedStart: 26,
      storedEnd: 26 + 2 * 65568,
    })
    expect(
      storedRangeForPlaintextRange(storedLength, 196608, 200000)
    ).toMatchObject({
      firstChunkIndex: 3,
      lastChunkIndex: 3,
      storedStart: 26 + 3 * 65568,
      storedEnd: storedLength,
    })
  })

  it('rejects a range that is empty or outside the file', () => {
    const storedLength = storedLengthOf(1000)
    for (const [start, end] of [
      [0, 0],
      [5, 5],
      [10, 5],
      [-1, 5],
      [0, 1001],
      [1000, 1001],
      [0.5, 2],
    ]) {
      expectReason(
        () => storedRangeForPlaintextRange(storedLength, start, end),
        'invalid_range'
      )
    }
    expectReason(
      () => storedRangeForPlaintextRange(storedLengthOf(0), 0, 1),
      'invalid_range'
    )
  })

  it('decrypts ranges that match the plaintext', async () => {
    for (const length of [1, 65536, 65537, 200000]) {
      const plaintext = mod251(length)
      const stored = await encryptAll(plaintext)
      const ranges = [
        [0, 1],
        [0, length],
        [length - 1, length],
        [Math.floor(length / 2), length],
        [65535, 65537],
        [65536, 131073],
        [100, 190000],
        [131072, 131073],
      ].filter(([start, end]) => start < end && end <= length)
      for (const [start, end] of ranges) {
        const range = storedRangeForPlaintextRange(stored.length, start, end)
        const out = decryptRange({
          context,
          storedLength: stored.length,
          start,
          end,
          storedBytes: stored.subarray(range.storedStart, range.storedEnd),
        })
        expect(out).toEqual(plaintext.subarray(start, end))
      }
    }
  })

  it('verifies every fetched chunk of a range', async () => {
    const plaintext = mod251(200000)
    const stored = await encryptAll(plaintext)
    const start = 60000
    const end = 140000
    const range = storedRangeForPlaintextRange(stored.length, start, end)
    const storedBytes = stored.slice(range.storedStart, range.storedEnd)
    const read = (bytes: Uint8Array, storedLength = stored.length) =>
      decryptRange({ context, storedLength, start, end, storedBytes: bytes })
    expect(read(storedBytes)).toEqual(plaintext.subarray(start, end))
    // A changed byte fails, also in a part of a chunk that is outside the range.
    for (const index of [0, 65568 - 1, 65568 + 10, 3 * 65568 - 1]) {
      expectReason(() => read(flipBit(storedBytes, index)), 'tag_mismatch')
    }
    // Chunks in a different sequence.
    expectReason(
      () =>
        read(
          concatBytes(
            storedBytes.subarray(65568, 2 * 65568),
            storedBytes.subarray(0, 65568),
            storedBytes.subarray(2 * 65568)
          )
        ),
      'tag_mismatch'
    )
    expectReason(
      () => read(storedBytes.subarray(0, storedBytes.length - 1)),
      'truncated'
    )
    expectReason(
      () => read(concatBytes(storedBytes, Uint8Array.of(0))),
      'trailing_data'
    )
  })

  it('fails if the server reports a shorter file than it stored', async () => {
    // The server cuts the file after chunk 1 and reports that length. Chunk
    // 1 is then read as the final chunk, and its tag does not match.
    const stored = await encryptAll(mod251(200000))
    const cut = stored.subarray(0, storedChunkOffset(2))
    const range = storedRangeForPlaintextRange(cut.length, 65536, 65537)
    expectReason(
      () =>
        decryptRange({
          context,
          storedLength: cut.length,
          start: 65536,
          end: 65537,
          storedBytes: cut.subarray(range.storedStart, range.storedEnd),
        }),
      'tag_mismatch'
    )
  })
})
