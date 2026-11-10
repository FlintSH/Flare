import { expect } from 'vitest'

import { E2eeError, type E2eeErrorReason } from '@/lib/e2ee/errors'
import type { Argon2id, Argon2idParameters } from '@/lib/e2ee/kdf'
import {
  blake3Hash,
  concatBytes,
  hexToBytes,
  le64,
} from '@/lib/e2ee/primitives'

/** Helpers for the tests of this directory. Not part of the library. */

export const hex = hexToBytes

/** Deterministic filler bytes: byte `i` is `(seed + i * 7) mod 256`. */
export function pattern(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index++) {
    out[index] = (seed + index * 7) & 0xff
  }
  return out
}

/** The plaintext of the `file` vectors: byte `i` is `i mod 251`. */
export function mod251(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index++) out[index] = index % 251
  return out
}

export function flipBit(bytes: Uint8Array, index: number): Uint8Array {
  const out = bytes.slice()
  out[index] ^= 0x01
  return out
}

export function expectReason(run: () => unknown, reason: E2eeErrorReason) {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(E2eeError)
  expect((thrown as E2eeError).reason).toBe(reason)
}

export async function expectReasonAsync(
  run: () => Promise<unknown>,
  reason: E2eeErrorReason
) {
  let thrown: unknown
  try {
    await run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(E2eeError)
  expect((thrown as E2eeError).reason).toBe(reason)
}

/** Cheap Argon2id parameters for tests that run the real function. */
export const FAST_KDF: Argon2idParameters = {
  memoryKib: 8,
  passes: 1,
  lanes: 1,
}

/**
 * A stand-in for Argon2id that hashes its whole input. It lets a test use
 * the production path, which always asks for 64 MiB, without the cost. `calls`
 * records what the library asked for.
 */
export function fakeArgon2id() {
  const calls: Array<{ memoryKib: number; passes: number; lanes: number }> = []
  const argon2id: Argon2id = (input) => {
    calls.push({
      memoryKib: input.memoryKib,
      passes: input.passes,
      lanes: input.lanes,
    })
    return blake3Hash(
      concatBytes(
        le64(input.memoryKib),
        le64(input.passes),
        le64(input.lanes),
        le64(input.password.length),
        input.password,
        input.salt
      )
    )
  }
  return { argon2id, calls }
}

export async function collect(
  source: AsyncIterable<Uint8Array>
): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const part of source) parts.push(part)
  return concatBytes(...parts)
}

/** Cuts bytes into pieces of the given sizes, repeating the list of sizes. */
export function* pieces(
  bytes: Uint8Array,
  sizes: number[]
): Generator<Uint8Array> {
  let offset = 0
  let turn = 0
  while (offset < bytes.length) {
    const size = sizes[turn++ % sizes.length]
    yield bytes.subarray(offset, offset + size)
    offset += size
  }
}
