/**
 * Flare end-to-end encryption, protocol version 1.
 *
 * The specification is `docs/e2ee-spec.md`. Every procedure is a pure
 * function with explicit random inputs. `random.ts` adds the wrappers that
 * draw randomness. The Argon2id parameters are fixed, so no function here
 * takes them. The `...ForTestsOnly` functions are not exported here; tests
 * import them from `testing.ts`.
 */
export * from './contexts'
export * from './errors'
export * from './types'
export * from './primitives'
export * from './seal'
export {
  type Argon2id,
  type Argon2idInput,
  type Argon2idParameters,
  KDF_OUTPUT_LENGTH,
  V1_ARGON2ID_PARAMETERS,
  encodeSecretText,
  stretchSecretText,
} from './kdf'
export {
  type AccountKeys,
  type AccountRecord,
  type PassphraseKeyInput,
  type PassphraseKeys,
  type SignedRequestInput,
  MNEMONIC_WORD_COUNT,
  WRAPPED_ROOT_LENGTH,
  accountKeysFromPrivateKey,
  createAccount,
  deriveAccountKeys,
  deriveKeyringKey,
  derivePassphraseKeys,
  encodeIdentifier,
  isSignedRequestMethod,
  mnemonicFromRootEntropy,
  normalizeIdentifier,
  openKeyring,
  passphraseKeysFromRoot,
  rootEntropyFromMnemonic,
  sealKeyring,
  signInMessage,
  signInSignature,
  signRequest,
  signedRequestMessage,
  unlockAccount,
  unlockMessage,
  unlockSignature,
  unwrapRoot,
  verifySignInSignature,
  verifySignedRequest,
  verifyUnlockSignature,
  wrapRoot,
} from './account'
export {
  type ByteSource,
  type ContentContext,
  type FileKeys,
  type FileLayout,
  type ParsedHeader,
  type StoredRange,
  type VerifiedFileEnd,
  CHUNK_SIZE,
  CHUNK_SIZE_LOG2,
  CHUNK_TAG_LENGTH,
  FORMAT_VERSION,
  HEADER_LENGTH,
  HEADER_MAGIC,
  NONCE_PREFIX_LENGTH,
  STORED_CHUNK_SIZE,
  buildHeader,
  contentContext,
  decryptChunk,
  decryptFile,
  decryptRange,
  deriveContentCipherKey,
  deriveContentMacKey,
  deriveFileKeys,
  deriveLinkSecretKey,
  deriveMetadataKey,
  deriveOcrTextKey,
  deriveThumbnailKey,
  encryptChunk,
  encryptFile,
  fileLayout,
  headerHash,
  parseHeader,
  readableStreamChunks,
  storedChunkOffset,
  storedLengthOf,
  storedRangeForPlaintextRange,
  wipeContentContext,
} from './file'
export {
  type PasswordStanzaParts,
  type PasswordStanzaUnwrapInput,
  type PasswordStanzaWrapInput,
  type PublicUnwrapInput,
  type PublicWrapInput,
  ACCOUNT_STANZA_LENGTH,
  PASSWORD_STANZA_LENGTH,
  openSealedLinkSecret,
  parsePasswordStanza,
  publicUnwrap,
  publicWrap,
  unwrapAccountStanza,
  unwrapAccountStanzaWithSharedSecret,
  unwrapFolderFileStanza,
  unwrapFolderLinkSecretStanza,
  unwrapParentFolderStanza,
  unwrapPasswordStanza,
  wrapAccountStanza,
  wrapFolderFileStanza,
  wrapFolderLinkSecretStanza,
  wrapParentFolderStanza,
  wrapPasswordStanza,
} from './stanza'
export * from './records'
export * from './link'
export * from './random'
