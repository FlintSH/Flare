import { CONTEXTS } from './contexts'
import { E2eeError } from './errors'
import { deriveLinkSecretKey } from './file'
import {
  type Argon2id,
  type Argon2idParameters,
  stretchSecretText,
  stretchSecretTextWithParametersForTestsOnly,
} from './kdf'
import {
  assertCanonicalX25519PublicKey,
  concatBytes,
  constantTimeEqual,
  deriveKey,
  ed2curvePrivate,
  ed2curvePublic,
  isAllZero,
  wipe,
  x25519PublicKey,
  x25519SharedSecret,
} from './primitives'
import {
  SEAL_ONCE_OVERHEAD,
  SEAL_OVERHEAD,
  openExact,
  openOnce,
  seal,
  sealOnce,
} from './seal'
import {
  type AccountPrivateKey,
  type AccountPublicKey,
  type EphemeralPrivateKey,
  type FileKey,
  type FolderPrivateKey,
  type FolderPublicKey,
  type HeaderHash,
  type LinkSecret,
  type PasswordKey,
  type PasswordSalt,
  type SealNonce,
  type StanzaKey,
  type X25519PrivateKey,
  type X25519PublicKey,
  asAccountPublicKey,
  asEphemeralPublicKey,
  asFileKey,
  asFolderPrivateKey,
  asHeaderHash,
  asLinkSecret,
  asPasswordSalt,
} from './types'

/**
 * Stanzas of section 8: the public-key wrap, the account stanza, the
 * password stanza and the folder stanzas. Each function returns the record
 * without the `record_version` byte (see `records.ts`).
 */

const PUBLIC_KEY_LENGTH = 32

// --- Public-key wrap (section 8.4.1) ---

function deriveStanzaKey(
  context: string,
  privateKey: X25519PrivateKey,
  peerPublicKey: X25519PublicKey,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array
): StanzaKey {
  const sharedSecret = x25519SharedSecret(privateKey, peerPublicKey)
  const material = concatBytes(
    sharedSecret,
    ephemeralPublicKey,
    recipientPublicKey
  )
  const stanzaKey = deriveKey<'stanza_key'>(context, material)
  wipe(sharedSecret, material)
  return stanzaKey
}

export interface PublicWrapInput {
  /** An X25519 public key in its canonical form. */
  readonly recipientPublicKey: X25519PublicKey
  /**
   * `random(32)`. Each stanza has its own: never use one ephemeral key pair
   * for two stanzas, also not for two stanzas of one file. Erase it after
   * the call.
   */
  readonly ephemeralPrivateKey: EphemeralPrivateKey
  readonly context: string
  readonly associatedData: Uint8Array
  readonly secret: Uint8Array
}

/**
 * `public_wrap(recipient_public_key, context, associated_data, secret)`.
 * The output is `ephemeral_public_key || seal_once(stanza_key, associated_data, secret)`.
 * A `recipient_public_key` that is not canonical fails with
 * `non_canonical_public_key`.
 */
export function publicWrap(input: PublicWrapInput): Uint8Array {
  assertCanonicalX25519PublicKey(
    input.recipientPublicKey,
    'recipient_public_key'
  )
  const ephemeralPublicKey = x25519PublicKey(input.ephemeralPrivateKey)
  const stanzaKey = deriveStanzaKey(
    input.context,
    input.ephemeralPrivateKey,
    input.recipientPublicKey,
    ephemeralPublicKey,
    input.recipientPublicKey
  )
  const sealed = sealOnce(stanzaKey, input.associatedData, input.secret)
  wipe(stanzaKey)
  return concatBytes(ephemeralPublicKey, sealed)
}

export interface PublicUnwrapInput {
  /** The X25519 private key of the recipient. */
  readonly recipientPrivateKey: X25519PrivateKey
  readonly context: string
  readonly associatedData: Uint8Array
  readonly stanza: Uint8Array
  /** The exact length of the secret, if the caller knows it. */
  readonly secretLength?: number
}

/**
 * `public_unwrap(recipient_private_key, context, associated_data, stanza)`.
 * An `ephemeral_public_key` that is not canonical fails with
 * `non_canonical_public_key` before any key agreement.
 * `recipient_public_key` in the key derivation comes from the private key,
 * never from the server.
 */
export function publicUnwrap(input: PublicUnwrapInput): Uint8Array {
  const { stanza, secretLength } = input
  const minimum = PUBLIC_KEY_LENGTH + SEAL_ONCE_OVERHEAD
  if (stanza.length < minimum) {
    throw new E2eeError(
      'truncated',
      `A stanza has at least ${minimum} bytes, got ${stanza.length}`
    )
  }
  if (secretLength !== undefined && stanza.length !== minimum + secretLength) {
    throw new E2eeError(
      'bad_length',
      `The stanza must have ${minimum + secretLength} bytes, got ${stanza.length}`
    )
  }
  const ephemeralPublicKey = asEphemeralPublicKey(
    stanza.subarray(0, PUBLIC_KEY_LENGTH)
  )
  assertCanonicalX25519PublicKey(ephemeralPublicKey, 'ephemeral_public_key')
  const recipientPublicKey = x25519PublicKey(input.recipientPrivateKey)
  const stanzaKey = deriveStanzaKey(
    input.context,
    input.recipientPrivateKey,
    ephemeralPublicKey,
    ephemeralPublicKey,
    recipientPublicKey
  )
  try {
    return openOnce(
      stanzaKey,
      input.associatedData,
      stanza.subarray(PUBLIC_KEY_LENGTH)
    )
  } finally {
    wipe(stanzaKey)
  }
}

// --- Account stanza (section 8.1) ---

/** `ephemeral_public_key || wrapped_file_key`: 32 + 64 = 96 bytes. */
export const ACCOUNT_STANZA_LENGTH = PUBLIC_KEY_LENGTH + 32 + SEAL_ONCE_OVERHEAD

/** The sender needs only `account_public_key`. Fails if the key has no X25519 form. */
export function wrapAccountStanza(input: {
  readonly accountPublicKey: AccountPublicKey
  readonly ephemeralPrivateKey: EphemeralPrivateKey
  readonly headerHash: HeaderHash
  readonly fileKey: FileKey
}): Uint8Array {
  return publicWrap({
    recipientPublicKey: ed2curvePublic(input.accountPublicKey),
    ephemeralPrivateKey: input.ephemeralPrivateKey,
    context: CONTEXTS.accountStanza,
    associatedData: asHeaderHash(input.headerHash),
    secret: asFileKey(input.fileKey),
  })
}

/** `accountPrivateKey` is the current key or an old key of the keyring. */
export function unwrapAccountStanza(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly headerHash: HeaderHash
  readonly stanza: Uint8Array
}): FileKey {
  const exchangePrivateKey = ed2curvePrivate(input.accountPrivateKey)
  try {
    return publicUnwrap({
      recipientPrivateKey: exchangePrivateKey,
      context: CONTEXTS.accountStanza,
      associatedData: asHeaderHash(input.headerHash),
      stanza: input.stanza,
      secretLength: 32,
    }) as FileKey
  } finally {
    wipe(exchangePrivateKey)
  }
}

/**
 * The unwrap procedure of section 8.1 for a caller that did step 2, the
 * X25519 operation, with a different implementation: the function of the
 * browser (section 9.8.3). The result is the same as `unwrapAccountStanza`.
 *
 * `sharedSecret` is `X25519(exchange_private_key, ephemeral_public_key)`,
 * where `ephemeral_public_key` is the first 32 bytes of the stanza.
 * `exchangePublicKey` must come from the private key of the caller, never
 * from the server. This function still does every check of the procedure:
 * the length, the canonical form of `ephemeral_public_key`, and a
 * `shared_secret` that is not all zero.
 */
export function unwrapAccountStanzaWithSharedSecret(input: {
  readonly sharedSecret: Uint8Array
  readonly exchangePublicKey: X25519PublicKey
  readonly headerHash: HeaderHash
  readonly stanza: Uint8Array
}): FileKey {
  const { stanza, sharedSecret } = input
  if (stanza.length !== ACCOUNT_STANZA_LENGTH) {
    throw new E2eeError(
      'bad_length',
      `An account stanza has ${ACCOUNT_STANZA_LENGTH} bytes, got ${stanza.length}`
    )
  }
  if (sharedSecret.length !== 32) {
    throw new E2eeError('bad_length', 'shared_secret must have 32 bytes')
  }
  const ephemeralPublicKey = stanza.subarray(0, PUBLIC_KEY_LENGTH)
  assertCanonicalX25519PublicKey(ephemeralPublicKey, 'ephemeral_public_key')
  assertCanonicalX25519PublicKey(input.exchangePublicKey, 'exchange_public_key')
  if (isAllZero(sharedSecret)) {
    throw new E2eeError(
      'low_order_point',
      'The X25519 shared secret is all zero'
    )
  }
  const material = concatBytes(
    sharedSecret,
    ephemeralPublicKey,
    input.exchangePublicKey
  )
  const stanzaKey = deriveKey<'stanza_key'>(CONTEXTS.accountStanza, material)
  wipe(material)
  try {
    return openOnce(
      stanzaKey,
      asHeaderHash(input.headerHash),
      stanza.subarray(PUBLIC_KEY_LENGTH)
    ) as FileKey
  } finally {
    wipe(stanzaKey)
  }
}

// --- Password stanza (section 8.2) ---

/** `seal_once` of a 32-byte key: 64 bytes. */
const WRAPPED_FILE_KEY_LENGTH = 32 + SEAL_ONCE_OVERHEAD
/** `seal` of a 32-byte secret with a random nonce: 88 bytes. */
const SEALED_LINK_SECRET_LENGTH = 32 + SEAL_OVERHEAD
/** `password_salt || owner_public_key || wrapped_file_key || sealed_link_secret`: 216 bytes. */
export const PASSWORD_STANZA_LENGTH =
  32 + 32 + WRAPPED_FILE_KEY_LENGTH + SEALED_LINK_SECRET_LENGTH

export interface PasswordStanzaParts {
  readonly passwordSalt: PasswordSalt
  readonly ownerPublicKey: AccountPublicKey
  readonly wrappedFileKey: Uint8Array
  readonly sealedLinkSecret: Uint8Array
}

export function parsePasswordStanza(stanza: Uint8Array): PasswordStanzaParts {
  if (stanza.length !== PASSWORD_STANZA_LENGTH) {
    throw new E2eeError(
      'bad_length',
      `A password stanza has ${PASSWORD_STANZA_LENGTH} bytes, got ${stanza.length}`
    )
  }
  return {
    passwordSalt: asPasswordSalt(stanza.subarray(0, 32)),
    ownerPublicKey: asAccountPublicKey(stanza.subarray(32, 64)),
    wrappedFileKey: stanza.subarray(64, 64 + WRAPPED_FILE_KEY_LENGTH),
    sealedLinkSecret: stanza.subarray(64 + WRAPPED_FILE_KEY_LENGTH),
  }
}

/** `Argon2id(password, password_salt)`: the production stretch, or the one of a test. */
type Stretch = (
  password: string,
  passwordSalt: PasswordSalt,
  argon2id: Argon2id
) => Promise<Uint8Array>

function stretchWithParametersForTestsOnly(
  parameters: Argon2idParameters
): Stretch {
  return (password, passwordSalt, argon2id) =>
    stretchSecretTextWithParametersForTestsOnly(
      password,
      passwordSalt,
      parameters,
      argon2id
    )
}

async function derivePasswordKey(
  stretch: Stretch,
  input: {
    readonly password: string
    readonly passwordSalt: PasswordSalt
    readonly linkSecret: LinkSecret
    readonly ownerPublicKey: AccountPublicKey
    readonly headerHash: HeaderHash
    readonly argon2id: Argon2id
  }
): Promise<PasswordKey> {
  asLinkSecret(input.linkSecret)
  asAccountPublicKey(input.ownerPublicKey)
  asHeaderHash(input.headerHash)
  const stretchedPassword = await stretch(
    input.password,
    asPasswordSalt(input.passwordSalt),
    input.argon2id
  )
  const material = concatBytes(
    stretchedPassword,
    input.linkSecret,
    input.ownerPublicKey,
    input.headerHash
  )
  const passwordKey = deriveKey<'password_key'>(
    CONTEXTS.passwordStanza,
    material
  )
  wipe(stretchedPassword, material)
  return passwordKey
}

export interface PasswordStanzaWrapInput {
  readonly password: string
  /** `random(32)`. A new one for each stanza: `password_key` must encrypt one message only. */
  readonly passwordSalt: PasswordSalt
  /** `random(32)`. A new one for each stanza. The share link carries it. */
  readonly linkSecret: LinkSecret
  /** The `account_public_key` of the owner at this time. */
  readonly ownerPublicKey: AccountPublicKey
  readonly headerHash: HeaderHash
  readonly fileKey: FileKey
  /** `random(24)`, the nonce of `sealed_link_secret`. */
  readonly linkSecretNonce: SealNonce
  readonly argon2id: Argon2id
}

async function wrapPasswordStanzaWith(
  stretch: Stretch,
  input: PasswordStanzaWrapInput
): Promise<{ passwordKey: PasswordKey; stanza: Uint8Array }> {
  asFileKey(input.fileKey)
  const passwordKey = await derivePasswordKey(stretch, input)
  const wrappedFileKey = sealOnce(passwordKey, input.headerHash, input.fileKey)
  const linkSecretKey = deriveLinkSecretKey(input.fileKey)
  // `link_secret_key` does not change when the owner changes the password,
  // thus this box has a random nonce and is not a one-time box.
  const sealedLinkSecret = seal(
    linkSecretKey,
    input.linkSecretNonce,
    input.headerHash,
    input.linkSecret
  )
  wipe(linkSecretKey)
  return {
    passwordKey,
    stanza: concatBytes(
      input.passwordSalt,
      input.ownerPublicKey,
      wrappedFileKey,
      sealedLinkSecret
    ),
  }
}

/**
 * The wrap procedure of section 8.2, with the fixed Argon2id parameters of
 * protocol version 1 (section 4.3).
 */
export async function wrapPasswordStanza(
  input: PasswordStanzaWrapInput
): Promise<Uint8Array> {
  const { passwordKey, stanza } = await wrapPasswordStanzaWith(
    stretchSecretText,
    input
  )
  wipe(passwordKey)
  return stanza
}

export interface PasswordStanzaUnwrapInput {
  readonly password: string
  /** From the share link. */
  readonly linkSecret: LinkSecret
  readonly headerHash: HeaderHash
  readonly stanza: Uint8Array
  readonly argon2id: Argon2id
}

async function unwrapPasswordStanzaWith(
  stretch: Stretch,
  input: PasswordStanzaUnwrapInput
): Promise<FileKey> {
  const parts = parsePasswordStanza(input.stanza)
  const passwordKey = await derivePasswordKey(stretch, {
    password: input.password,
    passwordSalt: parts.passwordSalt,
    linkSecret: input.linkSecret,
    ownerPublicKey: parts.ownerPublicKey,
    headerHash: input.headerHash,
    argon2id: input.argon2id,
  })
  try {
    return openOnce(
      passwordKey,
      input.headerHash,
      parts.wrappedFileKey
    ) as FileKey
  } finally {
    wipe(passwordKey)
  }
}

/**
 * The unwrap procedure of section 8.2, with the fixed Argon2id parameters
 * of protocol version 1. A wrong password, a wrong link or a stanza of a
 * different file all give `tag_mismatch`.
 */
export function unwrapPasswordStanza(
  input: PasswordStanzaUnwrapInput
): Promise<FileKey> {
  return unwrapPasswordStanzaWith(stretchSecretText, input)
}

/**
 * TEST ONLY. The wrap with explicit Argon2id parameters, so that a test
 * vector can be cheap. Returns `password_key` so a vector can check it.
 * Application code must not call this.
 */
export function wrapPasswordStanzaWithParametersForTestsOnly(
  input: PasswordStanzaWrapInput,
  parameters: Argon2idParameters
): Promise<{ passwordKey: PasswordKey; stanza: Uint8Array }> {
  return wrapPasswordStanzaWith(
    stretchWithParametersForTestsOnly(parameters),
    input
  )
}

/** TEST ONLY. The unwrap with explicit Argon2id parameters. Application code must not call this. */
export function unwrapPasswordStanzaWithParametersForTestsOnly(
  input: PasswordStanzaUnwrapInput,
  parameters: Argon2idParameters
): Promise<FileKey> {
  return unwrapPasswordStanzaWith(
    stretchWithParametersForTestsOnly(parameters),
    input
  )
}

/**
 * The owner has `file_key` and gets `link_secret` back from the stanza, to
 * show the share link again.
 */
export function openSealedLinkSecret(input: {
  readonly fileKey: FileKey
  readonly headerHash: HeaderHash
  readonly stanza: Uint8Array
}): LinkSecret {
  const parts = parsePasswordStanza(input.stanza)
  const linkSecretKey = deriveLinkSecretKey(input.fileKey)
  try {
    return openExact(
      linkSecretKey,
      asHeaderHash(input.headerHash),
      parts.sealedLinkSecret,
      32,
      'sealed_link_secret'
    ) as LinkSecret
  } finally {
    wipe(linkSecretKey)
  }
}

// --- Folder stanzas (sections 8.4.2 and 8.4.3) ---

/** Each folder stanza wraps 32 bytes: 96 bytes, as an account stanza. */
const FOLDER_STANZA_LENGTH = PUBLIC_KEY_LENGTH + 32 + SEAL_ONCE_OVERHEAD

/** `folder_file_stanza`, for a public file without a password in a folder. */
export function wrapFolderFileStanza(input: {
  readonly folderPublicKey: FolderPublicKey
  readonly ephemeralPrivateKey: EphemeralPrivateKey
  readonly headerHash: HeaderHash
  readonly fileKey: FileKey
}): Uint8Array {
  return publicWrap({
    recipientPublicKey: input.folderPublicKey,
    ephemeralPrivateKey: input.ephemeralPrivateKey,
    context: CONTEXTS.folderFileStanza,
    associatedData: asHeaderHash(input.headerHash),
    secret: asFileKey(input.fileKey),
  })
}

export function unwrapFolderFileStanza(input: {
  readonly folderPrivateKey: FolderPrivateKey
  readonly headerHash: HeaderHash
  readonly stanza: Uint8Array
}): FileKey {
  return publicUnwrap({
    recipientPrivateKey: input.folderPrivateKey,
    context: CONTEXTS.folderFileStanza,
    associatedData: asHeaderHash(input.headerHash),
    stanza: input.stanza,
    secretLength: 32,
  }) as FileKey
}

/** `folder_link_secret_stanza`, for a file with a password stanza in a folder. */
export function wrapFolderLinkSecretStanza(input: {
  readonly folderPublicKey: FolderPublicKey
  readonly ephemeralPrivateKey: EphemeralPrivateKey
  readonly headerHash: HeaderHash
  readonly linkSecret: LinkSecret
}): Uint8Array {
  return publicWrap({
    recipientPublicKey: input.folderPublicKey,
    ephemeralPrivateKey: input.ephemeralPrivateKey,
    context: CONTEXTS.folderLinkSecretStanza,
    associatedData: asHeaderHash(input.headerHash),
    secret: asLinkSecret(input.linkSecret),
  })
}

export function unwrapFolderLinkSecretStanza(input: {
  readonly folderPrivateKey: FolderPrivateKey
  readonly headerHash: HeaderHash
  readonly stanza: Uint8Array
}): LinkSecret {
  return publicUnwrap({
    recipientPrivateKey: input.folderPrivateKey,
    context: CONTEXTS.folderLinkSecretStanza,
    associatedData: asHeaderHash(input.headerHash),
    stanza: input.stanza,
    secretLength: 32,
  }) as LinkSecret
}

/**
 * `parent_folder_stanza`: the private key of a folder, encrypted to the
 * public key of its parent. The associated data is the public key of the
 * child, which is calculated from its private key here. The private key is
 * wrapped as it is, without clamping (section 4.4, rule 3b).
 */
export function wrapParentFolderStanza(input: {
  readonly parentFolderPublicKey: FolderPublicKey
  readonly ephemeralPrivateKey: EphemeralPrivateKey
  readonly folderPrivateKey: FolderPrivateKey
}): Uint8Array {
  asFolderPrivateKey(input.folderPrivateKey)
  return publicWrap({
    recipientPublicKey: input.parentFolderPublicKey,
    ephemeralPrivateKey: input.ephemeralPrivateKey,
    context: CONTEXTS.parentFolderStanza,
    associatedData: x25519PublicKey(input.folderPrivateKey),
    secret: input.folderPrivateKey,
  })
}

/**
 * Opens the private key of a folder below. `folderPublicKey` is the public
 * key of that folder as the server lists it. It must be canonical. It is
 * the associated data, and the opened private key must give it, else
 * `key_mismatch` (section 8.4.2).
 */
export function unwrapParentFolderStanza(input: {
  readonly parentFolderPrivateKey: FolderPrivateKey
  readonly folderPublicKey: FolderPublicKey
  readonly stanza: Uint8Array
}): FolderPrivateKey {
  assertCanonicalX25519PublicKey(input.folderPublicKey, 'folder_public_key')
  if (input.stanza.length !== FOLDER_STANZA_LENGTH) {
    throw new E2eeError(
      'bad_length',
      `A parent folder stanza has ${FOLDER_STANZA_LENGTH} bytes, got ${input.stanza.length}`
    )
  }
  const folderPrivateKey = publicUnwrap({
    recipientPrivateKey: input.parentFolderPrivateKey,
    context: CONTEXTS.parentFolderStanza,
    associatedData: input.folderPublicKey,
    stanza: input.stanza,
    secretLength: 32,
  }) as FolderPrivateKey
  if (
    !constantTimeEqual(x25519PublicKey(folderPrivateKey), input.folderPublicKey)
  ) {
    wipe(folderPrivateKey)
    throw new E2eeError(
      'key_mismatch',
      'The folder private key does not give the folder public key'
    )
  }
  return folderPrivateKey
}
