import {
  type AccountKeys,
  createAccount,
  sealKeyring,
  wrapRoot,
} from './account'
import { type ByteSource, buildHeader, encryptFile } from './file'
import type { Argon2id, KdfParameters } from './kdf'
import {
  type FileMetadata,
  type FolderMetadata,
  type TagMetadata,
  folderPublicKeyOf,
  sealFileMetadata,
  sealFolderMetadata,
  sealFolderPrivateKey,
  sealOcrText,
  sealTagMetadata,
  sealThumbnail,
} from './records'
import {
  wrapAccountStanza,
  wrapFolderFileStanza,
  wrapFolderLinkSecretStanza,
  wrapParentFolderStanza,
  wrapPasswordStanza,
} from './stanza'
import type {
  AccountPrivateKey,
  AccountPublicKey,
  EphemeralPrivateKey,
  FileHeader,
  FileKey,
  FolderPrivateKey,
  FolderPublicKey,
  HeaderHash,
  LinkSecret,
  NoncePrefix,
  PassphraseSalt,
  PasswordSalt,
  RootEntropy,
  SealNonce,
  WrapKey,
  WrappedRoot,
} from './types'

/**
 * The only module of the library that draws randomness.
 *
 * Every procedure in the other modules takes its random values as
 * parameters, so that test vectors fix the output. The functions here are
 * thin wrappers that draw those values from `crypto.getRandomValues` and
 * call the deterministic procedure. They contain no other logic.
 */

/** `random(n)` from the platform generator. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  // getRandomValues fills at most 65536 bytes in one call.
  for (let offset = 0; offset < length; offset += 65536) {
    globalThis.crypto.getRandomValues(
      out.subarray(offset, Math.min(length, offset + 65536))
    )
  }
  return out
}

// --- Random values, one function for each type ---

export const generateRootEntropy = () => randomBytes(32) as RootEntropy
export const generatePassphraseSalt = () => randomBytes(32) as PassphraseSalt
export const generateFileKey = () => randomBytes(32) as FileKey
export const generateNoncePrefix = () => randomBytes(16) as NoncePrefix
export const generateSealNonce = () => randomBytes(24) as SealNonce
export const generateEphemeralPrivateKey = () =>
  randomBytes(32) as EphemeralPrivateKey
export const generateLinkSecret = () => randomBytes(32) as LinkSecret
export const generatePasswordSalt = () => randomBytes(32) as PasswordSalt
export const generateFolderPrivateKey = () =>
  randomBytes(32) as FolderPrivateKey

function withEphemeralKey<Result>(
  run: (ephemeralPrivateKey: EphemeralPrivateKey) => Result
): Result {
  const ephemeralPrivateKey = generateEphemeralPrivateKey()
  try {
    return run(ephemeralPrivateKey)
  } finally {
    ephemeralPrivateKey.fill(0)
  }
}

// --- Account ---

/** Section 5.4 with a new `root_entropy`, salt and nonce. */
export function createRandomAccount(input: {
  readonly passphrase: string
  readonly argon2id: Argon2id
  readonly kdfParameters?: KdfParameters
}) {
  return createAccount({
    ...input,
    rootEntropy: generateRootEntropy(),
    passphraseSalt: generatePassphraseSalt(),
    wrapNonce: generateSealNonce(),
  })
}

export function wrapRootWithRandomNonce(input: {
  readonly wrapKey: WrapKey
  readonly accountPublicKey: AccountPublicKey
  readonly rootEntropy: RootEntropy
}): WrappedRoot {
  return wrapRoot({ ...input, nonce: generateSealNonce() })
}

export function sealKeyringWithRandomNonce(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly oldPrivateKeys: readonly AccountPrivateKey[]
}): Uint8Array {
  return sealKeyring({ ...input, nonce: generateSealNonce() })
}

// --- Files ---

/** A new `file_key` and a new header for one upload. */
export function createRandomFile(): {
  readonly fileKey: FileKey
  readonly noncePrefix: NoncePrefix
  readonly header: FileHeader
} {
  const noncePrefix = generateNoncePrefix()
  return {
    fileKey: generateFileKey(),
    noncePrefix,
    header: buildHeader(noncePrefix),
  }
}

/** `encryptFile` with a new `nonce_prefix`. The first piece of the output is the header. */
export function encryptFileWithRandomNoncePrefix(
  fileKey: FileKey,
  plaintext: ByteSource
) {
  return encryptFile(fileKey, generateNoncePrefix(), plaintext)
}

// --- Stanzas ---

export function wrapAccountStanzaWithRandomKey(input: {
  readonly accountPublicKey: AccountPublicKey
  readonly headerHash: HeaderHash
  readonly fileKey: FileKey
}): Uint8Array {
  return withEphemeralKey((ephemeralPrivateKey) =>
    wrapAccountStanza({ ...input, ephemeralPrivateKey })
  )
}

/** Section 8.2 with a new salt, a new `link_secret` and a new nonce. The share link carries `linkSecret`. */
export async function wrapRandomPasswordStanza(input: {
  readonly password: string
  readonly ownerPublicKey: AccountPublicKey
  readonly headerHash: HeaderHash
  readonly fileKey: FileKey
  readonly argon2id: Argon2id
}): Promise<{ readonly linkSecret: LinkSecret; readonly stanza: Uint8Array }> {
  const linkSecret = generateLinkSecret()
  const stanza = await wrapPasswordStanza({
    ...input,
    passwordSalt: generatePasswordSalt(),
    linkSecret,
    linkSecretNonce: generateSealNonce(),
  })
  return { linkSecret, stanza }
}

export function wrapFolderFileStanzaWithRandomKey(input: {
  readonly folderPublicKey: FolderPublicKey
  readonly headerHash: HeaderHash
  readonly fileKey: FileKey
}): Uint8Array {
  return withEphemeralKey((ephemeralPrivateKey) =>
    wrapFolderFileStanza({ ...input, ephemeralPrivateKey })
  )
}

export function wrapFolderLinkSecretStanzaWithRandomKey(input: {
  readonly folderPublicKey: FolderPublicKey
  readonly headerHash: HeaderHash
  readonly linkSecret: LinkSecret
}): Uint8Array {
  return withEphemeralKey((ephemeralPrivateKey) =>
    wrapFolderLinkSecretStanza({ ...input, ephemeralPrivateKey })
  )
}

export function wrapParentFolderStanzaWithRandomKey(input: {
  readonly parentFolderPublicKey: FolderPublicKey
  readonly folderPrivateKey: FolderPrivateKey
}): Uint8Array {
  return withEphemeralKey((ephemeralPrivateKey) =>
    wrapParentFolderStanza({ ...input, ephemeralPrivateKey })
  )
}

// --- Records ---

export function sealFileMetadataWithRandomNonce(input: {
  readonly fileKey: FileKey
  readonly headerHash: HeaderHash
  readonly metadata: FileMetadata
}): Uint8Array {
  return sealFileMetadata({ ...input, nonce: generateSealNonce() })
}

export function sealOcrTextWithRandomNonce(input: {
  readonly fileKey: FileKey
  readonly headerHash: HeaderHash
  readonly ocrText: string
}): Uint8Array {
  return sealOcrText({ ...input, nonce: generateSealNonce() })
}

export function sealThumbnailWithRandomNonce(input: {
  readonly fileKey: FileKey
  readonly headerHash: HeaderHash
  readonly thumbnail: Uint8Array
}): Uint8Array {
  return sealThumbnail({ ...input, nonce: generateSealNonce() })
}

export function sealTagMetadataWithRandomNonce(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly metadata: TagMetadata
}): Uint8Array {
  return sealTagMetadata({ ...input, nonce: generateSealNonce() })
}

export function sealFolderMetadataWithRandomNonce(input: {
  readonly folderPrivateKey: FolderPrivateKey
  readonly metadata: FolderMetadata
}): Uint8Array {
  return sealFolderMetadata({ ...input, nonce: generateSealNonce() })
}

export function sealFolderPrivateKeyWithRandomNonce(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly folderPrivateKey: FolderPrivateKey
}): Uint8Array {
  return sealFolderPrivateKey({ ...input, nonce: generateSealNonce() })
}

/**
 * Steps 1 to 5 of section 8.4.2 with a new key pair and new nonces. The
 * caller sends everything but `folderPrivateKey` to the server.
 */
export function createRandomFolder(input: {
  readonly accountKeys: Pick<AccountKeys, 'accountPrivateKey'>
  readonly metadata: FolderMetadata
  /** The public key of the parent folder, if the folder has a parent. */
  readonly parentFolderPublicKey?: FolderPublicKey
}): {
  readonly folderPrivateKey: FolderPrivateKey
  readonly folderPublicKey: FolderPublicKey
  readonly sealedFolderMetadata: Uint8Array
  readonly sealedFolderPrivateKey: Uint8Array
  readonly parentFolderStanza?: Uint8Array
} {
  const folderPrivateKey = generateFolderPrivateKey()
  return {
    folderPrivateKey,
    folderPublicKey: folderPublicKeyOf(folderPrivateKey),
    sealedFolderMetadata: sealFolderMetadataWithRandomNonce({
      folderPrivateKey,
      metadata: input.metadata,
    }),
    sealedFolderPrivateKey: sealFolderPrivateKeyWithRandomNonce({
      accountPrivateKey: input.accountKeys.accountPrivateKey,
      folderPrivateKey,
    }),
    parentFolderStanza: input.parentFolderPublicKey
      ? wrapParentFolderStanzaWithRandomKey({
          parentFolderPublicKey: input.parentFolderPublicKey,
          folderPrivateKey,
        })
      : undefined,
  }
}
