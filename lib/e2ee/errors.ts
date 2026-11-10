/**
 * The one error type of the E2EE library.
 *
 * A caller decides what to do from `reason`. The message is for logs and
 * names only public facts (which value, which length). It never contains a
 * key, a plaintext or a passphrase.
 */
export const E2EE_ERROR_REASONS = [
  /** An authentication tag did not match. Wrong key, wrong associated data or changed bytes. */
  'tag_mismatch',
  /** A value does not have the length that its type requires. */
  'bad_length',
  /** A `format_version`, `record_version` or `protocol_version` that this client does not know. */
  'unknown_version',
  /** The file header does not start with `FLAREE2E`. */
  'bad_magic',
  /** The file header has a `chunk_size_log2` other than 16. */
  'unsupported_chunk_size',
  /** The input ended before the final chunk, or a record is too short to split. */
  'truncated',
  /** Bytes follow the final chunk of a file. */
  'trailing_data',
  /** An X25519 operation gave the all-zero shared secret. */
  'low_order_point',
  /** An Ed25519 public key does not decode, or has no X25519 form. */
  'invalid_public_key',
  /** An X25519 public key is not in its canonical form (section 4.4, rule 3a). */
  'non_canonical_public_key',
  /** A final chunk of length zero at a position other than chunk 0 (section 7.4, rule 8). */
  'empty_final_chunk',
  /** The mnemonic is not 24 valid English BIP39 words with a correct checksum. */
  'invalid_mnemonic',
  /** A decrypted secret does not give the public key that the record names. */
  'key_mismatch',
  /** A plaintext byte range is outside the file. */
  'invalid_range',
  /** Text is not valid hexadecimal, base64url or a JSON object. */
  'invalid_encoding',
  /** An argument has the wrong type or an impossible value. */
  'invalid_argument',
] as const

export type E2eeErrorReason = (typeof E2EE_ERROR_REASONS)[number]

export class E2eeError extends Error {
  readonly reason: E2eeErrorReason

  constructor(reason: E2eeErrorReason, message: string) {
    super(message)
    this.name = 'E2eeError'
    this.reason = reason
  }
}

export function isE2eeError(
  error: unknown,
  reason?: E2eeErrorReason
): error is E2eeError {
  return (
    error instanceof E2eeError &&
    (reason === undefined || error.reason === reason)
  )
}
