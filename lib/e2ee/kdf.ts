import { E2eeError } from './errors'
import { utf8, wipe } from './primitives'

/**
 * The passphrase stretch (sections 1.5.2, 4.3 and 4.4, rules 5 and 6).
 *
 * The Argon2id parameters are fixed for protocol version 1. No record stores
 * them, the server does not send them, and no production function of this
 * library takes them as an argument. Different parameters need a new
 * protocol version (section 1.5.3, rule 4).
 *
 * The Argon2id function itself is injected. `argon2-noble.ts` has a pure
 * JavaScript one for tests and for the server. The browser will pass a
 * WebAssembly one with the same signature.
 */

export interface Argon2idParameters {
  /** Memory in KiB. 64 MiB is `65536`. */
  readonly memoryKib: number
  readonly passes: number
  readonly lanes: number
}

/**
 * The second parameter set of RFC 9106: 64 MiB, 3 passes, 4 lanes. The only
 * parameters of protocol version 1 (section 4.3), for the passphrase of an
 * account and for the password of a file.
 */
export const V1_ARGON2ID_PARAMETERS: Argon2idParameters = Object.freeze({
  memoryKib: 65536,
  passes: 3,
  lanes: 4,
})

export const KDF_OUTPUT_LENGTH = 32

/** What the library asks of the injected Argon2id function. */
export interface Argon2idInput extends Argon2idParameters {
  readonly password: Uint8Array
  readonly salt: Uint8Array
  /** Always 32 in protocol version 1. */
  readonly outputLength: number
}

/**
 * Argon2id, version `0x13`, with no secret value and no associated data
 * (section 4.4, rule 6). The implementation can be synchronous or not.
 */
export type Argon2id = (
  input: Argon2idInput
) => Uint8Array | Promise<Uint8Array>

/** Section 4.4, rule 5: Unicode NFKC, then UTF-8. Spaces stay. */
export function encodeSecretText(text: string): Uint8Array {
  return utf8(text.normalize('NFKC'))
}

async function stretch(
  text: string,
  salt: Uint8Array,
  parameters: Argon2idParameters,
  argon2id: Argon2id
): Promise<Uint8Array> {
  if (salt.length !== 32) {
    throw new E2eeError('bad_length', 'An Argon2id salt must have 32 bytes')
  }
  const password = encodeSecretText(text)
  try {
    const output = await argon2id({
      password,
      salt,
      memoryKib: parameters.memoryKib,
      passes: parameters.passes,
      lanes: parameters.lanes,
      outputLength: KDF_OUTPUT_LENGTH,
    })
    if (
      !(output instanceof Uint8Array) ||
      output.length !== KDF_OUTPUT_LENGTH
    ) {
      throw new E2eeError(
        'bad_length',
        'The Argon2id implementation did not return 32 bytes'
      )
    }
    return output
  } finally {
    wipe(password)
  }
}

/**
 * `Argon2id(text, salt)` for a passphrase or a file password, with the fixed
 * parameters of protocol version 1. There is no parameter argument.
 */
export function stretchSecretText(
  text: string,
  salt: Uint8Array,
  argon2id: Argon2id
): Promise<Uint8Array> {
  return stretch(text, salt, V1_ARGON2ID_PARAMETERS, argon2id)
}

/**
 * TEST ONLY. The same stretch with explicit Argon2id parameters, so that
 * test vectors can use cheap ones. The result is not a value of protocol
 * version 1 unless the parameters are `V1_ARGON2ID_PARAMETERS`. Application
 * code must not call this.
 */
export async function stretchSecretTextWithParametersForTestsOnly(
  text: string,
  salt: Uint8Array,
  parameters: Argon2idParameters,
  argon2id: Argon2id
): Promise<Uint8Array> {
  const { memoryKib, passes, lanes } = parameters
  // RFC 9106, section 3.1.
  const valid =
    Number.isSafeInteger(memoryKib) &&
    Number.isSafeInteger(passes) &&
    Number.isSafeInteger(lanes) &&
    passes >= 1 &&
    passes <= 0xffffffff &&
    lanes >= 1 &&
    lanes <= 0xffffff &&
    memoryKib >= 8 * lanes &&
    memoryKib <= 0xffffffff
  if (!valid) {
    throw new E2eeError(
      'invalid_argument',
      'The Argon2id parameters are not valid'
    )
  }
  return stretch(text, salt, parameters, argon2id)
}
