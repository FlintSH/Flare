import { argon2id as nobleRaw } from '@noble/hashes/argon2.js'
import { argon2id as wasmRaw } from 'hash-wasm'
import { describe, expect, it } from 'vitest'

import { derivePassphraseKeys } from '@/lib/e2ee/account'
import { nobleArgon2id } from '@/lib/e2ee/argon2-noble'
import { wasmArgon2id } from '@/lib/e2ee/client/argon2-wasm'
import {
  V1_ARGON2ID_PARAMETERS,
  encodeSecretText,
  stretchSecretText,
} from '@/lib/e2ee/kdf'
import { bytesToHex, hexToBytes } from '@/lib/e2ee/primitives'
import type { PassphraseSalt } from '@/lib/e2ee/types'
import vectors from '@/lib/e2ee/vectors/v1.json'

import { pattern } from '../test-support'

// The browser stretches passphrases with hash-wasm. These tests fix its
// output to the vectors of the independent reference program and to the
// pure JavaScript implementation that the rest of the suite uses.

interface Vector {
  procedure: string
  name: string
  input: Record<string, unknown>
  output: Record<string, unknown>
}

const all = (vectors as { vectors: Vector[] }).vectors
const passphraseVectors = all.filter(
  (vector) => vector.procedure === 'passphrase_keys'
)

function isReal(vector: Vector) {
  return (
    vector.input.memory_kib === V1_ARGON2ID_PARAMETERS.memoryKib &&
    vector.input.passes === V1_ARGON2ID_PARAMETERS.passes &&
    vector.input.lanes === V1_ARGON2ID_PARAMETERS.lanes
  )
}

describe('Argon2id through WebAssembly', () => {
  it('has vectors to check, one of them with the real parameters', () => {
    expect(passphraseVectors.length).toBeGreaterThanOrEqual(6)
    expect(passphraseVectors.filter(isReal)).toHaveLength(1)
  })

  it.each(passphraseVectors.map((vector) => [vector.name, vector] as const))(
    'gives passphrase_root of the vector: %s',
    async (_name, vector) => {
      const output = await wasmArgon2id({
        password: encodeSecretText(vector.input.passphrase_text as string),
        salt: hexToBytes(vector.input.passphrase_salt as string),
        memoryKib: vector.input.memory_kib as number,
        passes: vector.input.passes as number,
        lanes: vector.input.lanes as number,
        outputLength: 32,
      })
      expect(bytesToHex(output)).toBe(vector.output.passphrase_root)
    },
    30_000
  )

  it('gives the keys of the real-parameter vector through the production function', async () => {
    const vector = passphraseVectors.find(isReal)!
    const keys = await derivePassphraseKeys({
      passphrase: vector.input.passphrase_text as string,
      passphraseSalt: hexToBytes(
        vector.input.passphrase_salt as string
      ) as PassphraseSalt,
      argon2id: wasmArgon2id,
    })
    expect(bytesToHex(keys.authPrivateKey)).toBe(vector.output.auth_private_key)
    expect(bytesToHex(keys.authPublicKey)).toBe(vector.output.auth_public_key)
    expect(bytesToHex(keys.wrapKey)).toBe(vector.output.wrap_key)
  }, 30_000)

  it('agrees with the pure JavaScript implementation on the real-parameter file password vector', async () => {
    const vector = all.find(
      (candidate) =>
        candidate.procedure === 'password_stanza' &&
        isReal(candidate) &&
        typeof candidate.output.password_key === 'string'
    )!
    const text = vector.input.password_text as string
    const salt = hexToBytes(vector.input.password_salt as string)
    const viaWasm = await stretchSecretText(text, salt, wasmArgon2id)
    const viaNoble = await stretchSecretText(text, salt, nobleArgon2id)
    expect(bytesToHex(viaWasm)).toBe(bytesToHex(viaNoble))
  }, 60_000)

  it('agrees with the implementation that passes RFC 9106, on the inputs of section 5.3', async () => {
    // Section 5.3 of RFC 9106: password 32 bytes of 0x01, salt 16 bytes of
    // 0x02, secret 8 bytes of 0x03, 32 KiB, 3 passes, 4 lanes. Its tag also
    // covers associated data, which hash-wasm cannot take and Flare never
    // uses. `primitives.test.ts` checks the pure JavaScript implementation
    // against the tag of the RFC. Here both get the same inputs without
    // associated data, with the secret and without it.
    const password = new Uint8Array(32).fill(1)
    const salt = new Uint8Array(16).fill(2)
    const secret = new Uint8Array(8).fill(3)
    const parameters = { m: 32, t: 3, p: 4, dkLen: 32, version: 0x13 }
    const wasm = (withSecret: boolean) =>
      wasmRaw({
        password,
        salt,
        ...(withSecret ? { secret } : {}),
        iterations: 3,
        parallelism: 4,
        memorySize: 32,
        hashLength: 32,
        outputType: 'hex',
      })
    expect(await wasm(true)).toBe(
      bytesToHex(nobleRaw(password, salt, { ...parameters, key: secret }))
    )
    expect(await wasm(false)).toBe(
      bytesToHex(nobleRaw(password, salt, parameters))
    )
  })

  it('agrees with the pure JavaScript implementation on other inputs', async () => {
    for (const [memoryKib, passes, lanes] of [
      [8, 1, 1],
      [64, 2, 2],
      [256, 3, 4],
      [1024, 1, 8],
    ]) {
      const input = {
        password: pattern(memoryKib % 61, passes),
        salt: pattern(32, lanes),
        memoryKib,
        passes,
        lanes,
        outputLength: 32,
      }
      expect(bytesToHex(await wasmArgon2id(input))).toBe(
        bytesToHex(await nobleArgon2id(input))
      )
    }
  })

  it('does not change the password or the salt that it gets', async () => {
    const password = pattern(20, 9)
    const salt = pattern(32, 3)
    await wasmArgon2id({
      password,
      salt,
      memoryKib: 8,
      passes: 1,
      lanes: 1,
      outputLength: 32,
    })
    expect(password).toEqual(pattern(20, 9))
    expect(salt).toEqual(pattern(32, 3))
  })
})
