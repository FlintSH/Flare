import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js'

import { CONTEXTS, PROTOCOL_VERSION } from './contexts'
import { E2eeError } from './errors'
import {
  type Argon2id,
  type Argon2idParameters,
  stretchSecretText,
  stretchSecretTextWithParametersForTestsOnly,
} from './kdf'
import {
  asciiBytes,
  blake3Hash,
  concatBytes,
  constantTimeEqual,
  deriveKey,
  ed2curvePrivate,
  ed2curvePublic,
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  utf8,
  wipe,
} from './primitives'
import { open, openExact, seal } from './seal'
import {
  type AccountPrivateKey,
  type AccountPublicKey,
  type AuthPrivateKey,
  type AuthPublicKey,
  type Challenge,
  type ExchangePrivateKey,
  type ExchangePublicKey,
  type KeyringKey,
  type PassphraseRoot,
  type PassphraseSalt,
  type RootEntropy,
  type SealNonce,
  type Signature,
  type WrapKey,
  type WrappedRoot,
  asAccountPrivateKey,
  asRootEntropy,
} from './types'

/**
 * Account keys, sign-in, unlock and the keyring (sections 5.1, 5.4, 6.2,
 * 6.3, 6.6 and 8.3.3). Each function is deterministic: nonces and salts are parameters.
 */

// --- Mnemonic (section 4.4, rule 10) ---

export const MNEMONIC_WORD_COUNT = 24

/** The 24 English BIP39 words of `root_entropy`, in lower case with one space between them. */
export function mnemonicFromRootEntropy(rootEntropy: RootEntropy): string {
  asRootEntropy(rootEntropy)
  return entropyToMnemonic(rootEntropy, englishWordlist)
}

/**
 * Decodes a mnemonic that a user typed. Upper case and extra white space are
 * accepted, because they do not change which words the user means.
 */
export function rootEntropyFromMnemonic(mnemonic: string): RootEntropy {
  const words = mnemonic.trim().toLowerCase().split(/\s+/)
  const invalid = () =>
    new E2eeError(
      'invalid_mnemonic',
      'The mnemonic is not 24 valid words with a correct checksum'
    )
  if (words.length !== MNEMONIC_WORD_COUNT) throw invalid()
  let entropy: Uint8Array
  try {
    entropy = mnemonicToEntropy(words.join(' '), englishWordlist)
  } catch {
    throw invalid()
  }
  if (entropy.length !== 32) throw invalid()
  return entropy as RootEntropy
}

// --- Key hierarchy (section 5.1) ---

export interface AccountKeys {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly exchangePrivateKey: ExchangePrivateKey
  readonly exchangePublicKey: ExchangePublicKey
}

/** The key pairs of one `account_private_key`. Also used for the old keys of the keyring. */
export function accountKeysFromPrivateKey(
  accountPrivateKey: AccountPrivateKey
): AccountKeys {
  asAccountPrivateKey(accountPrivateKey)
  const accountPublicKey =
    ed25519PublicKey<'account_public_key'>(accountPrivateKey)
  return {
    accountPrivateKey,
    accountPublicKey,
    exchangePrivateKey: ed2curvePrivate(accountPrivateKey),
    exchangePublicKey: ed2curvePublic(accountPublicKey),
  }
}

export function deriveAccountKeys(rootEntropy: RootEntropy): AccountKeys {
  asRootEntropy(rootEntropy)
  return accountKeysFromPrivateKey(
    deriveKey<'account_private_key'>(CONTEXTS.accountSeed, rootEntropy)
  )
}

export interface PassphraseKeys {
  readonly authPrivateKey: AuthPrivateKey
  readonly authPublicKey: AuthPublicKey
  readonly wrapKey: WrapKey
}

/** `auth_seed` and `wrap_key` from `passphrase_root`. */
export function passphraseKeysFromRoot(
  passphraseRoot: PassphraseRoot
): PassphraseKeys {
  const authPrivateKey = deriveKey<'auth_private_key'>(
    CONTEXTS.auth,
    passphraseRoot
  )
  return {
    authPrivateKey,
    authPublicKey: ed25519PublicKey<'auth_public_key'>(authPrivateKey),
    wrapKey: deriveKey<'wrap_key'>(CONTEXTS.wrap, passphraseRoot),
  }
}

export interface PassphraseKeyInput {
  readonly passphrase: string
  readonly passphraseSalt: PassphraseSalt
  readonly argon2id: Argon2id
}

/**
 * Steps 2 and 3 of section 6.2. This is the function that a client calls at
 * sign-in. It uses the fixed Argon2id parameters of protocol version 1
 * (section 1.5.2, rule 4): the server sends none, so a compromised server
 * cannot make the test of passphrases easier. `passphrase_root` is erased.
 */
export async function derivePassphraseKeys(
  input: PassphraseKeyInput
): Promise<PassphraseKeys> {
  const passphraseRoot = (await stretchSecretText(
    input.passphrase,
    input.passphraseSalt,
    input.argon2id
  )) as PassphraseRoot
  const keys = passphraseKeysFromRoot(passphraseRoot)
  wipe(passphraseRoot)
  return keys
}

/**
 * TEST ONLY. Takes explicit Argon2id parameters and returns
 * `passphrase_root`, so that test vectors can be cheap and can check the
 * intermediate value. Application code must not call this.
 */
export async function derivePassphraseKeysWithParametersForTestsOnly(
  input: PassphraseKeyInput,
  parameters: Argon2idParameters
): Promise<PassphraseKeys & { readonly passphraseRoot: PassphraseRoot }> {
  const passphraseRoot = (await stretchSecretTextWithParametersForTestsOnly(
    input.passphrase,
    input.passphraseSalt,
    parameters,
    input.argon2id
  )) as PassphraseRoot
  return { ...passphraseKeysFromRoot(passphraseRoot), passphraseRoot }
}

// --- wrapped_root (sections 5.3 and 6.2) ---

export const WRAPPED_ROOT_LENGTH = 88

/** `wrapped_root = seal(wrap_key, nonce, account_public_key, root_entropy)`. */
export function wrapRoot(input: {
  readonly wrapKey: WrapKey
  readonly nonce: SealNonce
  readonly accountPublicKey: AccountPublicKey
  readonly rootEntropy: RootEntropy
}): WrappedRoot {
  asRootEntropy(input.rootEntropy)
  return seal(
    input.wrapKey,
    input.nonce,
    input.accountPublicKey,
    input.rootEntropy
  ) as WrappedRoot
}

/**
 * Steps 9 to 11 of section 6.2: open `wrapped_root`, derive the account
 * keys, and check that they give the `account_public_key` of the record.
 * Returns `root_entropy` too, because showing the mnemonic needs it. The
 * caller erases it (step 12).
 */
export function unwrapRoot(input: {
  readonly wrapKey: WrapKey
  readonly accountPublicKey: AccountPublicKey
  readonly wrappedRoot: Uint8Array
}): { readonly rootEntropy: RootEntropy; readonly accountKeys: AccountKeys } {
  const rootEntropy = openExact(
    input.wrapKey,
    input.accountPublicKey,
    input.wrappedRoot,
    32,
    'wrapped_root'
  ) as RootEntropy
  const accountKeys = deriveAccountKeys(rootEntropy)
  if (
    !constantTimeEqual(accountKeys.accountPublicKey, input.accountPublicKey)
  ) {
    wipe(
      rootEntropy,
      accountKeys.accountPrivateKey,
      accountKeys.exchangePrivateKey
    )
    throw new E2eeError(
      'key_mismatch',
      'root_entropy does not give the account_public_key of the record'
    )
  }
  return { rootEntropy, accountKeys }
}

/** Section 6.2 from the client side after the server released `wrapped_root`. `root_entropy` is erased. */
export function unlockAccount(input: {
  readonly wrapKey: WrapKey
  readonly accountPublicKey: AccountPublicKey
  readonly wrappedRoot: Uint8Array
}): AccountKeys {
  const { rootEntropy, accountKeys } = unwrapRoot(input)
  wipe(rootEntropy)
  return accountKeys
}

// --- Sign-in signature (section 6.2, step 4) ---

const OUTER_WHITE_SPACE = /^\p{White_Space}+|\p{White_Space}+$/gu

/**
 * The one form of an account identifier (section 4.4, rule 7): Unicode
 * NFKC, then without the characters that have the Unicode property
 * White_Space at the start and the end, then in lower case with the default
 * Unicode mapping (no locale).
 *
 * Each place that uses the identifier uses this function: the sign-in
 * signature here, and the fake salt of section 6.1 on the server. The result
 * depends on the Unicode version of the runtime (rule 13).
 */
export function normalizeIdentifier(identifier: string): string {
  return identifier
    .normalize('NFKC')
    .replace(OUTER_WHITE_SPACE, '')
    .toLowerCase()
}

/** `normalizeIdentifier` as UTF-8, the bytes that `blake3_hash` and `blake3_keyed_hash` get. */
export function encodeIdentifier(identifier: string): Uint8Array {
  return utf8(normalizeIdentifier(identifier))
}

/** `context || challenge || blake3_hash(identifier)`, the message of both signatures of the sign-in key pair. */
function authKeyMessage(
  context: typeof CONTEXTS.signIn | typeof CONTEXTS.unlock,
  challenge: Challenge,
  identifier: string
): Uint8Array {
  if (challenge.length !== 32) {
    throw new E2eeError('bad_length', 'challenge must have 32 bytes')
  }
  return concatBytes(
    asciiBytes(context),
    challenge,
    blake3Hash(encodeIdentifier(identifier))
  )
}

/** `"flare e2ee v1 sign-in" || challenge || blake3_hash(identifier)`. */
export function signInMessage(
  challenge: Challenge,
  identifier: string
): Uint8Array {
  return authKeyMessage(CONTEXTS.signIn, challenge, identifier)
}

export function signInSignature(input: {
  readonly authPrivateKey: AuthPrivateKey
  readonly challenge: Challenge
  readonly identifier: string
}): Signature {
  return ed25519Sign(
    input.authPrivateKey,
    signInMessage(input.challenge, input.identifier)
  )
}

/** Step 6 of section 6.2, for the server. */
export function verifySignInSignature(input: {
  readonly authPublicKey: AuthPublicKey
  readonly challenge: Challenge
  readonly identifier: string
  readonly signature: Uint8Array
}): boolean {
  return ed25519Verify(
    input.authPublicKey,
    signInMessage(input.challenge, input.identifier),
    input.signature
  )
}

// --- Unlock signature (section 6.3, step 4) ---

/**
 * `"flare e2ee v1 unlock" || challenge || blake3_hash(identifier)`. The
 * context is not the one of the sign-in signature, so a signature for one
 * request is not valid for the other.
 */
export function unlockMessage(
  challenge: Challenge,
  identifier: string
): Uint8Array {
  return authKeyMessage(CONTEXTS.unlock, challenge, identifier)
}

export function unlockSignature(input: {
  readonly authPrivateKey: AuthPrivateKey
  readonly challenge: Challenge
  readonly identifier: string
}): Signature {
  return ed25519Sign(
    input.authPrivateKey,
    unlockMessage(input.challenge, input.identifier)
  )
}

/** Step 5 of section 6.3, for the server. */
export function verifyUnlockSignature(input: {
  readonly authPublicKey: AuthPublicKey
  readonly challenge: Challenge
  readonly identifier: string
  readonly signature: Uint8Array
}): boolean {
  return ed25519Verify(
    input.authPublicKey,
    unlockMessage(input.challenge, input.identifier),
    input.signature
  )
}

// --- Signed requests (section 6.6) ---

export interface SignedRequestInput {
  readonly challenge: Challenge
  /** The HTTP method in upper case ASCII letters, for example `POST`. */
  readonly method: string
  /**
   * The path and the query of the request line, in the percent-encoded form
   * that the client sends. The server uses the request line as it arrived,
   * before a proxy or a base path changes it.
   */
  readonly path: string
  /** The bytes of the request body. Leave out for a request without a body. */
  readonly body?: Uint8Array
}

/** Section 4.4, rule 8: `method` is one or more of the letters `A` to `Z`. */
export function isSignedRequestMethod(method: string): boolean {
  return /^[A-Z]+$/.test(method)
}

/**
 * `"flare e2ee v1 request" || challenge || blake3_hash(method || " " || path) || blake3_hash(body)`
 * with the encodings of section 4.4, rule 8. The method is used as it is: a
 * method that is not upper case ASCII fails with `invalid_argument`.
 */
export function signedRequestMessage(input: SignedRequestInput): Uint8Array {
  if (input.challenge.length !== 32) {
    throw new E2eeError('bad_length', 'challenge must have 32 bytes')
  }
  if (!isSignedRequestMethod(input.method)) {
    throw new E2eeError(
      'invalid_argument',
      'method must be upper case ASCII letters'
    )
  }
  return concatBytes(
    asciiBytes(CONTEXTS.request),
    input.challenge,
    blake3Hash(
      concatBytes(asciiBytes(input.method), asciiBytes(' '), utf8(input.path))
    ),
    blake3Hash(input.body ?? new Uint8Array(0))
  )
}

/**
 * For the client. The signer changes the ASCII letters `a` to `z` of the
 * method to upper case, and no other character, then signs. The client must
 * send the method in upper case too, because the verifier does not convert.
 */
export function signRequest(
  input: SignedRequestInput & { readonly accountPrivateKey: AccountPrivateKey }
): { readonly signedMessage: Uint8Array; readonly signature: Signature } {
  const signedMessage = signedRequestMessage({
    ...input,
    method: input.method.replace(/[a-z]/g, (letter) => letter.toUpperCase()),
  })
  return {
    signedMessage,
    signature: ed25519Sign(input.accountPrivateKey, signedMessage),
  }
}

/**
 * Step 5 of section 6.6, for the server. Returns `false` for a wrong
 * signature and for a method that is not upper case ASCII: the verifier
 * rejects such a method and never converts it.
 */
export function verifySignedRequest(
  input: SignedRequestInput & {
    readonly accountPublicKey: AccountPublicKey
    readonly signature: Uint8Array
  }
): boolean {
  if (!isSignedRequestMethod(input.method)) return false
  return ed25519Verify(
    input.accountPublicKey,
    signedRequestMessage(input),
    input.signature
  )
}

// --- Keyring (section 8.3.3, steps 4 and 5) ---

export function deriveKeyringKey(
  accountPrivateKey: AccountPrivateKey
): KeyringKey {
  asAccountPrivateKey(accountPrivateKey)
  return deriveKey<'keyring_key'>(CONTEXTS.keyring, accountPrivateKey)
}

/**
 * `sealed_keyring = seal(keyring_key, nonce, new account_public_key, old_private_keys)`.
 * `oldPrivateKeys` is newest first (section 4.4, rule 11). Both account keys
 * are the new ones.
 *
 * An empty list fails with `invalid_argument`: a client must not store a
 * sealed empty list. An account with no old key has no `sealed_keyring`, so
 * the caller sends none and the server stores none.
 */
export function sealKeyring(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly nonce: SealNonce
  readonly oldPrivateKeys: readonly AccountPrivateKey[]
}): Uint8Array {
  if (input.oldPrivateKeys.length === 0) {
    throw new E2eeError(
      'invalid_argument',
      'A keyring must hold at least one old private key'
    )
  }
  const list = concatBytes(...input.oldPrivateKeys.map(asAccountPrivateKey))
  const keyringKey = deriveKeyringKey(input.accountPrivateKey)
  const sealed = seal(keyringKey, input.nonce, input.accountPublicKey, list)
  wipe(keyringKey, list)
  return sealed
}

/**
 * The old account private keys, newest first. Call this only if the account
 * record has a `sealed_keyring`: no record means no old key. A sealed empty
 * list is not a valid record and fails with `bad_length`.
 */
export function openKeyring(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly sealedKeyring: Uint8Array
}): AccountPrivateKey[] {
  const keyringKey = deriveKeyringKey(input.accountPrivateKey)
  let list: Uint8Array
  try {
    list = open(keyringKey, input.accountPublicKey, input.sealedKeyring)
  } finally {
    wipe(keyringKey)
  }
  if (list.length === 0 || list.length % 32 !== 0) {
    wipe(list)
    throw new E2eeError(
      'bad_length',
      'old_private_keys is not a list of one or more 32-byte keys'
    )
  }
  const keys: AccountPrivateKey[] = []
  for (let offset = 0; offset < list.length; offset += 32) {
    keys.push(asAccountPrivateKey(list.slice(offset, offset + 32)))
  }
  wipe(list)
  return keys
}

// --- Account creation (section 5.4) ---

/** What the client sends to the server in step 7 of section 5.4. */
export interface AccountRecord {
  readonly accountPublicKey: AccountPublicKey
  readonly passphraseSalt: PassphraseSalt
  readonly protocolVersion: typeof PROTOCOL_VERSION
  readonly authPublicKey: AuthPublicKey
  readonly wrappedRoot: WrappedRoot
}

/**
 * Steps 2 to 6 of section 5.4 with the three random values as parameters.
 * The Argon2id parameters are the fixed ones of protocol version 1.
 * `passphrase_root`, `auth_private_key` and `wrap_key` are erased (step 9).
 * The caller shows `mnemonic` and then drops it.
 */
export async function createAccount(input: {
  readonly rootEntropy: RootEntropy
  readonly passphrase: string
  readonly passphraseSalt: PassphraseSalt
  readonly wrapNonce: SealNonce
  readonly argon2id: Argon2id
}): Promise<{
  readonly record: AccountRecord
  readonly accountKeys: AccountKeys
  readonly mnemonic: string
}> {
  const accountKeys = deriveAccountKeys(input.rootEntropy)
  const passphraseKeys = await derivePassphraseKeys({
    passphrase: input.passphrase,
    passphraseSalt: input.passphraseSalt,
    argon2id: input.argon2id,
  })
  const wrappedRoot = wrapRoot({
    wrapKey: passphraseKeys.wrapKey,
    nonce: input.wrapNonce,
    accountPublicKey: accountKeys.accountPublicKey,
    rootEntropy: input.rootEntropy,
  })
  wipe(passphraseKeys.authPrivateKey, passphraseKeys.wrapKey)
  return {
    record: {
      accountPublicKey: accountKeys.accountPublicKey,
      passphraseSalt: input.passphraseSalt,
      protocolVersion: PROTOCOL_VERSION,
      authPublicKey: passphraseKeys.authPublicKey,
      wrappedRoot,
    },
    accountKeys,
    mnemonic: mnemonicFromRootEntropy(input.rootEntropy),
  }
}
