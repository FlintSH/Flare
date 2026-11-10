import { E2eeError } from './errors'

/**
 * Domain types for the values of section 2.3.
 *
 * Each value is a `Uint8Array` with a compile-time brand, so a `FileKey`
 * cannot go where a `WrapKey` is expected. The only way to get a branded
 * value from raw bytes is the `as...` function of its type, which checks the
 * length. The functions do not copy: the caller keeps ownership of the
 * buffer and can erase it with `wipe`.
 */
declare const kind: unique symbol

export type Bytes<Kind extends string> = Uint8Array & {
  readonly [kind]: Kind
}

function fixedLength<Kind extends string>(name: Kind, length: number) {
  return (bytes: Uint8Array): Bytes<Kind> => {
    if (!(bytes instanceof Uint8Array)) {
      throw new E2eeError('invalid_argument', `${name} must be a Uint8Array`)
    }
    if (bytes.length !== length) {
      throw new E2eeError(
        'bad_length',
        `${name} must have ${length} bytes, got ${bytes.length}`
      )
    }
    return bytes as Bytes<Kind>
  }
}

// Account (sections 5 and 6)
export type RootEntropy = Bytes<'root_entropy'>
export const asRootEntropy = fixedLength('root_entropy', 32)
/** The 32-byte Ed25519 seed. The same value as `account_seed` (section 4.4, rule 1). */
export type AccountPrivateKey = Bytes<'account_private_key'>
export const asAccountPrivateKey = fixedLength('account_private_key', 32)
export type AccountPublicKey = Bytes<'account_public_key'>
export const asAccountPublicKey = fixedLength('account_public_key', 32)
export type ExchangePrivateKey = Bytes<'exchange_private_key'>
export const asExchangePrivateKey = fixedLength('exchange_private_key', 32)
export type ExchangePublicKey = Bytes<'exchange_public_key'>
export const asExchangePublicKey = fixedLength('exchange_public_key', 32)
export type PassphraseSalt = Bytes<'passphrase_salt'>
export const asPassphraseSalt = fixedLength('passphrase_salt', 32)
export type PassphraseRoot = Bytes<'passphrase_root'>
export const asPassphraseRoot = fixedLength('passphrase_root', 32)
/** The 32-byte Ed25519 seed. The same value as `auth_seed`. */
export type AuthPrivateKey = Bytes<'auth_private_key'>
export const asAuthPrivateKey = fixedLength('auth_private_key', 32)
export type AuthPublicKey = Bytes<'auth_public_key'>
export const asAuthPublicKey = fixedLength('auth_public_key', 32)
export type WrapKey = Bytes<'wrap_key'>
export const asWrapKey = fixedLength('wrap_key', 32)
export type WrappedRoot = Bytes<'wrapped_root'>
export const asWrappedRoot = fixedLength('wrapped_root', 88)
export type KeyringKey = Bytes<'keyring_key'>
export const asKeyringKey = fixedLength('keyring_key', 32)
export type Challenge = Bytes<'challenge'>
export const asChallenge = fixedLength('challenge', 32)
export type Signature = Bytes<'signature'>
export const asSignature = fixedLength('signature', 64)

// Files (section 7)
export type FileKey = Bytes<'file_key'>
export const asFileKey = fixedLength('file_key', 32)
export type ContentCipherKey = Bytes<'content_cipher_key'>
export const asContentCipherKey = fixedLength('content_cipher_key', 32)
export type ContentMacKey = Bytes<'content_mac_key'>
export const asContentMacKey = fixedLength('content_mac_key', 32)
export type MetadataKey = Bytes<'metadata_key'>
export const asMetadataKey = fixedLength('metadata_key', 32)
export type OcrTextKey = Bytes<'ocr_text_key'>
export const asOcrTextKey = fixedLength('ocr_text_key', 32)
export type ThumbnailKey = Bytes<'thumbnail_key'>
export const asThumbnailKey = fixedLength('thumbnail_key', 32)
export type LinkSecretKey = Bytes<'link_secret_key'>
export const asLinkSecretKey = fixedLength('link_secret_key', 32)
export type NoncePrefix = Bytes<'nonce_prefix'>
export const asNoncePrefix = fixedLength('nonce_prefix', 16)
export type FileHeader = Bytes<'header'>
export type HeaderHash = Bytes<'header_hash'>
export const asHeaderHash = fixedLength('header_hash', 32)

// Stanzas (section 8)
export type EphemeralPrivateKey = Bytes<'ephemeral_private_key'>
export const asEphemeralPrivateKey = fixedLength('ephemeral_private_key', 32)
export type EphemeralPublicKey = Bytes<'ephemeral_public_key'>
export const asEphemeralPublicKey = fixedLength('ephemeral_public_key', 32)
export type SharedSecret = Bytes<'shared_secret'>
export type StanzaKey = Bytes<'stanza_key'>
export const asStanzaKey = fixedLength('stanza_key', 32)
export type LinkSecret = Bytes<'link_secret'>
export const asLinkSecret = fixedLength('link_secret', 32)
export type PasswordSalt = Bytes<'password_salt'>
export const asPasswordSalt = fixedLength('password_salt', 32)
export type PasswordKey = Bytes<'password_key'>
export const asPasswordKey = fixedLength('password_key', 32)
export type FolderPrivateKey = Bytes<'folder_private_key'>
export const asFolderPrivateKey = fixedLength('folder_private_key', 32)
export type FolderPublicKey = Bytes<'folder_public_key'>
export const asFolderPublicKey = fixedLength('folder_public_key', 32)

// Records (sections 8.4.2, 9 and 12.1)
export type FolderMetadataKey = Bytes<'folder_metadata_key'>
export const asFolderMetadataKey = fixedLength('folder_metadata_key', 32)
export type FolderOwnerKey = Bytes<'folder_owner_key'>
export const asFolderOwnerKey = fixedLength('folder_owner_key', 32)
export type TagKey = Bytes<'tag_key'>
export const asTagKey = fixedLength('tag_key', 32)

// Sealed box (section 4.2)
export type SealNonce = Bytes<'seal_nonce'>
export const asSealNonce = fixedLength('seal_nonce', 24)
/** A seal key with no other role. For test vectors of `seal` itself. */
export type GenericSealKey = Bytes<'seal_key'>
export const asGenericSealKey = fixedLength('seal_key', 32)

/**
 * The keys that `seal` and `open` accept. `FileKey`, `RootEntropy` and the
 * private keys are deliberately absent: the protocol never seals with them
 * directly, only with a key derived from them.
 */
export type SealKey =
  | WrapKey
  | KeyringKey
  | StanzaKey
  | PasswordKey
  | LinkSecretKey
  | MetadataKey
  | OcrTextKey
  | ThumbnailKey
  | FolderMetadataKey
  | FolderOwnerKey
  | TagKey
  | GenericSealKey

export type X25519PrivateKey =
  ExchangePrivateKey | FolderPrivateKey | EphemeralPrivateKey
export type X25519PublicKey =
  ExchangePublicKey | FolderPublicKey | EphemeralPublicKey
export type Ed25519PrivateKey = AccountPrivateKey | AuthPrivateKey
export type Ed25519PublicKey = AccountPublicKey | AuthPublicKey
