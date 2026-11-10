import { E2eeError } from './errors'
import { utf8, wipe } from './primitives'

/**
 * Argon2id parameters and the passphrase stretch (sections 1.5.2, 4.3 and
 * 4.4, rules 5 and 6).
 *
 * The Argon2id function itself is injected. `argon2-noble.ts` has a pure
 * JavaScript one for tests and for the server. The browser will pass a
 * WebAssembly one with the same signature.
 */

/** The `kdf_parameters` of an account record (section 5.3). */
export interface KdfParameters {
  /** Memory in KiB. 64 MiB is `65536`. */
  readonly memoryKib: number
  readonly passes: number
  readonly lanes: number
}

/** The second parameter set of RFC 9106. The minimum of protocol version 1 (section 4.3). */
export const V1_KDF_PARAMETERS: KdfParameters = Object.freeze({
  memoryKib: 65536,
  passes: 3,
  lanes: 4,
})

export const KDF_OUTPUT_LENGTH = 32

export interface Argon2idInput {
  readonly password: Uint8Array
  readonly salt: Uint8Array
  readonly memoryKib: number
  readonly passes: number
  readonly lanes: number
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

/** Rejects values that are not Argon2id parameters at all (RFC 9106, section 3.1). */
export function assertValidKdfParameters(parameters: KdfParameters): void {
  const { memoryKib, passes, lanes } = parameters
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
      'invalid_kdf_parameters',
      'The Argon2id parameters are not valid'
    )
  }
}

/**
 * Section 1.5.2, rule 4. A parameter set is weaker than the minimum if its
 * memory, its passes or its lanes are below the value of section 4.3. A
 * compromised server could send weak parameters to make the test of
 * passphrases cheaper, so the client calls this before it stretches.
 */
export function assertKdfParametersMeetMinimum(
  parameters: KdfParameters
): void {
  assertValidKdfParameters(parameters)
  if (
    parameters.memoryKib < V1_KDF_PARAMETERS.memoryKib ||
    parameters.passes < V1_KDF_PARAMETERS.passes ||
    parameters.lanes < V1_KDF_PARAMETERS.lanes
  ) {
    throw new E2eeError(
      'weak_kdf_parameters',
      'The Argon2id parameters are weaker than the minimum of protocol version 1'
    )
  }
}

/** Section 4.4, rule 5: Unicode NFKC, then UTF-8. Spaces stay. */
export function encodeSecretText(text: string): Uint8Array {
  return utf8(text.normalize('NFKC'))
}

async function stretch(
  text: string,
  salt: Uint8Array,
  parameters: KdfParameters,
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
 * `Argon2id(text, salt)` for a passphrase or a file password. Rejects
 * parameters below the minimum of protocol version 1.
 */
export async function stretchSecretText(
  text: string,
  salt: Uint8Array,
  parameters: KdfParameters,
  argon2id: Argon2id
): Promise<Uint8Array> {
  assertKdfParametersMeetMinimum(parameters)
  return stretch(text, salt, parameters, argon2id)
}

/**
 * TEST ONLY. The same stretch without the minimum check, so test vectors can
 * use cheap parameters. Never call this with parameters from a server.
 */
export async function stretchSecretTextForTestsOnly(
  text: string,
  salt: Uint8Array,
  parameters: KdfParameters,
  argon2id: Argon2id
): Promise<Uint8Array> {
  assertValidKdfParameters(parameters)
  return stretch(text, salt, parameters, argon2id)
}
