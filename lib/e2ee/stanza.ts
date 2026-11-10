import { CONTEXTS } from './contexts'
import { E2eeError } from './errors'
import { deriveLinkSecretKey } from './file'
import {
  type Argon2id,
  type KdfParameters,
  V1_KDF_PARAMETERS,
  stretchSecretText,
  stretchSecretTextForTestsOnly,
} from './kdf'
import {
  concatBytes,
  constantTimeEqual,
  deriveKey,
  ed2curvePrivate,
  ed2curvePublic,
  wipe,
  x25519PublicKey,
  x25519SharedSecret,
} from './primitives'
import { SEAL_OVERHEAD, open, openExact, seal } from './seal'
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

const ZERO_NONCE_LENGTH = 24
const PUBLIC_KEY_LENGTH = 32

/** A stanza key encrypts one message only, thus its nonce is `zeros(24)`. */
function zeroNonce(): SealNonce {
  return new Uint8Array(ZERO_NONCE_LENGTH) as SealNonce
}

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
  /** An X25519 public key. */
  readonly recipientPublicKey: X25519PublicKey
  /** `random(32)`. Use it for one recipient key only, then erase it. */
  readonly ephemeralPrivateKey: EphemeralPrivateKey
  readonly context: string
  readonly associatedData: Uint8Array
  readonly secret: Uint8Array
}

/**
 * `public_wrap(recipient_public_key, context, associated_data, secret)`.
 * The output is `ephemeral_public_key || seal(stanza_key, zeros(24), associated_data, secret)`.
 */
export function publicWrap(input: PublicWrapInput): Uint8Array {
  const ephemeralPublicKey = x25519PublicKey(input.ephemeralPrivateKey)
  const stanzaKey = deriveStanzaKey(
    input.context,
    input.ephemeralPrivateKey,
    input.recipientPublicKey,
    ephemeralPublicKey,
    input.recipientPublicKey
  )
  const sealed = seal(
    stanzaKey,
    zeroNonce(),
    input.associatedData,
    input.secret
  )
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
 * The reverse of `public_wrap`. `recipient_public_key` in the key derivation
 * comes from the private key, never from the server.
 */
export function publicUnwrap(input: PublicUnwrapInput): Uint8Array {
  const { stanza, secretLength } = input
  const minimum = PUBLIC_KEY_LENGTH + SEAL_OVERHEAD
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
  const recipientPublicKey = x25519PublicKey(input.recipientPrivateKey)
  const stanzaKey = deriveStanzaKey(
    input.context,
    input.recipientPrivateKey,
    ephemeralPublicKey,
    ephemeralPublicKey,
    recipientPublicKey
  )
  try {
    return open(
      stanzaKey,
      input.associatedData,
      stanza.subarray(PUBLIC_KEY_LENGTH)
    )
  } finally {
    wipe(stanzaKey)
  }
}

// --- Account stanza (section 8.1) ---

export const ACCOUNT_STANZA_LENGTH = PUBLIC_KEY_LENGTH + SEAL_OVERHEAD + 32

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

// --- Password stanza (section 8.2) ---

const WRAPPED_KEY_LENGTH = SEAL_OVERHEAD + 32
/** `password_salt || owner_public_key || wrapped_file_key || sealed_link_secret` */
export const PASSWORD_STANZA_LENGTH = 32 + 32 + 2 * WRAPPED_KEY_LENGTH

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
    wrappedFileKey: stanza.subarray(64, 64 + WRAPPED_KEY_LENGTH),
    sealedLinkSecret: stanza.subarray(64 + WRAPPED_KEY_LENGTH),
  }
}

type Stretch = typeof stretchSecretText

async function derivePasswordKey(
  stretch: Stretch,
  input: {
    readonly password: string
    readonly passwordSalt: PasswordSalt
    readonly linkSecret: LinkSecret
    readonly ownerPublicKey: AccountPublicKey
    readonly headerHash: HeaderHash
    readonly argon2id: Argon2id
  },
  kdfParameters: KdfParameters
): Promise<PasswordKey> {
  asLinkSecret(input.linkSecret)
  asAccountPublicKey(input.ownerPublicKey)
  asHeaderHash(input.headerHash)
  const stretchedPassword = await stretch(
    input.password,
    asPasswordSalt(input.passwordSalt),
    kdfParameters,
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
  /** `random(32)` */
  readonly passwordSalt: PasswordSalt
  /** `random(32)`. The share link carries it. */
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
  input: PasswordStanzaWrapInput,
  kdfParameters: KdfParameters
): Promise<{ passwordKey: PasswordKey; stanza: Uint8Array }> {
  asFileKey(input.fileKey)
  const passwordKey = await derivePasswordKey(stretch, input, kdfParameters)
  const wrappedFileKey = seal(
    passwordKey,
    zeroNonce(),
    input.headerHash,
    input.fileKey
  )
  const linkSecretKey = deriveLinkSecretKey(input.fileKey)
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
 * The wrap procedure of section 8.2. The stanza does not record Argon2id
 * parameters, so this always uses the parameters of protocol version 1
 * (section 4.3).
 */
export async function wrapPasswordStanza(
  input: PasswordStanzaWrapInput
): Promise<Uint8Array> {
  const { passwordKey, stanza } = await wrapPasswordStanzaWith(
    stretchSecretText,
    input,
    V1_KDF_PARAMETERS
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
  input: PasswordStanzaUnwrapInput,
  kdfParameters: KdfParameters
): Promise<FileKey> {
  const parts = parsePasswordStanza(input.stanza)
  const passwordKey = await derivePasswordKey(
    stretch,
    {
      password: input.password,
      passwordSalt: parts.passwordSalt,
      linkSecret: input.linkSecret,
      ownerPublicKey: parts.ownerPublicKey,
      headerHash: input.headerHash,
      argon2id: input.argon2id,
    },
    kdfParameters
  )
  try {
    return open(passwordKey, input.headerHash, parts.wrappedFileKey) as FileKey
  } finally {
    wipe(passwordKey)
  }
}

/**
 * The unwrap procedure of section 8.2. A wrong password, a wrong link or a
 * stanza of a different file all give `tag_mismatch`.
 */
export function unwrapPasswordStanza(
  input: PasswordStanzaUnwrapInput
): Promise<FileKey> {
  return unwrapPasswordStanzaWith(stretchSecretText, input, V1_KDF_PARAMETERS)
}

/**
 * TEST ONLY. The wrap with explicit Argon2id parameters, which can be below
 * the minimum. Returns `password_key` so a test vector can check it.
 */
export function wrapPasswordStanzaForTestsOnly(
  input: PasswordStanzaWrapInput,
  kdfParameters: KdfParameters
): Promise<{ passwordKey: PasswordKey; stanza: Uint8Array }> {
  return wrapPasswordStanzaWith(
    stretchSecretTextForTestsOnly,
    input,
    kdfParameters
  )
}

/** TEST ONLY. The unwrap with explicit Argon2id parameters. */
export function unwrapPasswordStanzaForTestsOnly(
  input: PasswordStanzaUnwrapInput,
  kdfParameters: KdfParameters
): Promise<FileKey> {
  return unwrapPasswordStanzaWith(
    stretchSecretTextForTestsOnly,
    input,
    kdfParameters
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

const FOLDER_STANZA_LENGTH = PUBLIC_KEY_LENGTH + SEAL_OVERHEAD + 32

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
 * child, which is calculated from its private key here.
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
 * key of that folder as the server lists it. It is the associated data, and
 * the opened private key must give it, else `key_mismatch`.
 */
export function unwrapParentFolderStanza(input: {
  readonly parentFolderPrivateKey: FolderPrivateKey
  readonly folderPublicKey: FolderPublicKey
  readonly stanza: Uint8Array
}): FolderPrivateKey {
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
