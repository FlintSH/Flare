import { argon2idAsync } from '@noble/hashes/argon2.js'

import type { Argon2id } from './kdf'

/**
 * Argon2id in pure JavaScript, for tests and for the server. It is slow next
 * to WebAssembly: the browser will inject a different `Argon2id` function.
 * This module is separate so that a browser bundle does not have to include
 * it.
 *
 * The async variant gives the same bytes as the synchronous one and lets the
 * event loop run during the 64 MiB derivation.
 */
export const nobleArgon2id: Argon2id = ({
  password,
  salt,
  memoryKib,
  passes,
  lanes,
  outputLength,
}) =>
  argon2idAsync(password, salt, {
    m: memoryKib,
    t: passes,
    p: lanes,
    dkLen: outputLength,
    version: 0x13,
  })
