import { argon2id } from 'hash-wasm'

import type { Argon2id } from '../kdf'

/**
 * Argon2id through WebAssembly, for the browser (docs/e2ee-spec.md, section
 * 4.3). `hash-wasm` implements version `0x13` only and calculates the lanes
 * one after the other, which gives the same output as a threaded
 * implementation. This function takes no secret value and no associated
 * data (section 4.4, rule 6).
 *
 * It blocks the thread that calls it for about a second with the parameters
 * of protocol version 1. The application calls it in a worker, through
 * `workerArgon2id`.
 */
export const wasmArgon2id: Argon2id = (input) =>
  argon2id({
    password: input.password,
    salt: input.salt,
    iterations: input.passes,
    parallelism: input.lanes,
    memorySize: input.memoryKib,
    hashLength: input.outputLength,
    outputType: 'binary',
  })
