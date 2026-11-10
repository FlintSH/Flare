import { blake3 } from '@noble/hashes/blake3.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  deriveAccountKeys,
  deriveKeyringKey,
  derivePassphraseKeys,
  mnemonicFromRootEntropy,
  normalizeIdentifier,
  openKeyring,
  rootEntropyFromMnemonic,
  sealKeyring,
  signInSignature,
  signRequest,
  unlockSignature,
  unwrapRoot,
  verifySignInSignature,
  verifySignedRequest,
  verifyUnlockSignature,
  wrapRoot,
} from '@/lib/e2ee/account'
import { nobleArgon2id } from '@/lib/e2ee/argon2-noble'
import { E2eeError, type E2eeErrorReason } from '@/lib/e2ee/errors'
import {
  CHUNK_SIZE,
  buildHeader,
  contentContext,
  decryptChunk,
  decryptFile,
  deriveFileKeys,
  encryptFile,
  parseHeader,
} from '@/lib/e2ee/file'
import { type Argon2idParameters, V1_ARGON2ID_PARAMETERS } from '@/lib/e2ee/kdf'
import {
  blake3DeriveKey,
  blake3KeyedHash,
  bytesToHex,
  ed25519PublicKey,
  hexToBytes,
  utf8,
} from '@/lib/e2ee/primitives'
import {
  decodeRecord,
  deriveFolderMetadataKey,
  deriveFolderOwnerKey,
  deriveTagKey,
  encodeRecord,
  folderPublicKeyOf,
  openFileMetadata,
  openFolderMetadata,
  openFolderPrivateKey,
  openOcrText,
  openTagMetadata,
  openThumbnail,
  sealFileMetadataBytes,
  sealFolderMetadataBytes,
  sealFolderPrivateKey,
  sealOcrText,
  sealTagMetadataBytes,
  sealThumbnail,
} from '@/lib/e2ee/records'
import { open, seal } from '@/lib/e2ee/seal'
import {
  openSealedLinkSecret,
  publicUnwrap,
  publicWrap,
  unwrapAccountStanza,
  unwrapFolderFileStanza,
  unwrapFolderLinkSecretStanza,
  unwrapParentFolderStanza,
  unwrapPasswordStanza,
  wrapAccountStanza,
  wrapFolderFileStanza,
  wrapFolderLinkSecretStanza,
  wrapParentFolderStanza,
  wrapPasswordStanza,
} from '@/lib/e2ee/stanza'
import {
  derivePassphraseKeysWithParametersForTestsOnly,
  encryptChunkUnchecked,
  unwrapPasswordStanzaWithParametersForTestsOnly,
  wrapPasswordStanzaWithParametersForTestsOnly,
} from '@/lib/e2ee/testing'
import {
  asAccountPrivateKey,
  asAccountPublicKey,
  asAuthPrivateKey,
  asChallenge,
  asEphemeralPrivateKey,
  asFileKey,
  asFolderPrivateKey,
  asFolderPublicKey,
  asGenericSealKey,
  asHeaderHash,
  asLinkSecret,
  asNoncePrefix,
  asPassphraseSalt,
  asPasswordSalt,
  asRootEntropy,
  asSealNonce,
  asWrapKey,
} from '@/lib/e2ee/types'

import { collect, mod251 } from './test-support'

/**
 * Checks every vector of `lib/e2ee/vectors/v1.json` against the library.
 * The schema is `lib/e2ee/vectors/SCHEMA.md`. A separate reference program
 * makes the file from the specification, so this test is skipped while the
 * file does not exist.
 *
 * The test follows the schema, not one edition of the file. Where a vector
 * and the library disagree, the library is not changed to agree: the
 * disagreement is a finding about the specification or about one of the two
 * programs.
 */

const VECTORS_PATH = fileURLToPath(
  new URL('../../lib/e2ee/vectors/v1.json', import.meta.url)
)
const ARGON2_TIMEOUT = 300_000

type Fields = Record<string, unknown>
type Output = Record<string, string | number>
/** The `output` of a vector that the procedure must reject. */
const REJECTED = { error: true }

interface Vector {
  procedure: string
  name: string
  input: Fields
  output: Fields
}

// --- Readers that follow the naming rules of the schema ---

/**
 * A key that ends with `_text` holds UTF-8 text. The schema names one
 * exception: `sealed_ocr_text` is a sealed box in hexadecimal. (`ocr_text`,
 * the other name in that rule, is text, as its suffix says.)
 */
function isTextKey(key: string): boolean {
  return key.endsWith('_text') && key !== 'sealed_ocr_text'
}

function bytes(fields: Fields, key: string): Uint8Array {
  if (isTextKey(key)) throw new Error(`"${key}" is a text key`)
  const value = fields[key]
  if (typeof value !== 'string') {
    throw new Error(`input "${key}" must be a hexadecimal string`)
  }
  return hexToBytes(value)
}

function text(fields: Fields, key: string): string {
  if (!isTextKey(key)) throw new Error(`"${key}" is not a text key`)
  const value = fields[key]
  if (typeof value !== 'string') throw new Error(`input "${key}" must be text`)
  return value
}

function integer(fields: Fields, key: string): number {
  const value = fields[key]
  if (!Number.isSafeInteger(value)) {
    throw new Error(`input "${key}" must be an integer`)
  }
  return value as number
}

function boolean(fields: Fields, key: string): boolean {
  const value = fields[key]
  if (typeof value !== 'boolean') {
    throw new Error(`input "${key}" must be true or false`)
  }
  return value
}

function argon2idParameters(fields: Fields): Argon2idParameters {
  return {
    memoryKib: integer(fields, 'memory_kib'),
    passes: integer(fields, 'passes'),
    lanes: integer(fields, 'lanes'),
  }
}

/**
 * The specification fixes the parameters. A vector with other parameters is
 * a fast vector and must use a path of the library that is for tests only.
 */
function isRealKdf(parameters: Argon2idParameters): boolean {
  return (
    parameters.memoryKib === V1_ARGON2ID_PARAMETERS.memoryKib &&
    parameters.passes === V1_ARGON2ID_PARAMETERS.passes &&
    parameters.lanes === V1_ARGON2ID_PARAMETERS.lanes
  )
}

function chunkContext(input: Fields) {
  return contentContext(
    asFileKey(bytes(input, 'file_key')),
    buildHeader(asNoncePrefix(bytes(input, 'nonce_prefix')))
  )
}

function passwordUnwrapInput(input: Fields, stanza: Uint8Array) {
  return {
    password: text(input, 'password_text'),
    linkSecret: asLinkSecret(bytes(input, 'link_secret')),
    headerHash: asHeaderHash(bytes(input, 'header_hash')),
    stanza,
    argon2id: nobleArgon2id,
  }
}

/** `unwrap` with the fixed parameters through the production function, else through the test path. */
function unwrapPasswordStanzaOfVector(input: Fields, stanza: Uint8Array) {
  const parameters = argon2idParameters(input)
  const unwrapInput = passwordUnwrapInput(input, stanza)
  return isRealKdf(parameters)
    ? unwrapPasswordStanza(unwrapInput)
    : unwrapPasswordStanzaWithParametersForTestsOnly(unwrapInput, parameters)
}

const toHex = bytesToHex

// --- One function for each procedure of the schema ---
//
// Each returns exactly the output keys of the schema, in vector form. Where
// the inputs permit it, the function also runs the reverse procedure.

const PROCEDURES: Record<string, (input: Fields) => Output | Promise<Output>> =
  {
    blake3_derive_key(input) {
      return {
        key: toHex(
          blake3DeriveKey(
            text(input, 'context_text'),
            bytes(input, 'key_material')
          )
        ),
      }
    },

    blake3_keyed_hash(input) {
      return {
        hash: toHex(
          blake3KeyedHash(bytes(input, 'key'), bytes(input, 'message'))
        ),
      }
    },

    seal(input) {
      const key = asGenericSealKey(bytes(input, 'key'))
      const associatedData = bytes(input, 'associated_data')
      const message = bytes(input, 'message')
      const sealedBox = seal(
        key,
        asSealNonce(bytes(input, 'nonce')),
        associatedData,
        message
      )
      expect(open(key, associatedData, sealedBox)).toEqual(message)
      return { sealed_box: toHex(sealedBox) }
    },

    account_keys(input) {
      const rootEntropy = asRootEntropy(bytes(input, 'root_entropy'))
      const keys = deriveAccountKeys(rootEntropy)
      const mnemonic = mnemonicFromRootEntropy(rootEntropy)
      expect(rootEntropyFromMnemonic(mnemonic)).toEqual(rootEntropy)
      return {
        mnemonic_text: mnemonic,
        account_private_key: toHex(keys.accountPrivateKey),
        account_public_key: toHex(keys.accountPublicKey),
        exchange_private_key: toHex(keys.exchangePrivateKey),
        exchange_public_key: toHex(keys.exchangePublicKey),
      }
    },

    async passphrase_keys(input) {
      const parameters = argon2idParameters(input)
      const derivation = {
        passphrase: text(input, 'passphrase_text'),
        passphraseSalt: asPassphraseSalt(bytes(input, 'passphrase_salt')),
        argon2id: nobleArgon2id,
      }
      const keys = await derivePassphraseKeysWithParametersForTestsOnly(
        derivation,
        parameters
      )
      if (isRealKdf(parameters)) {
        // The function that a client calls at sign-in takes no parameters
        // and gives the same keys.
        const production = await derivePassphraseKeys(derivation)
        expect(production.wrapKey).toEqual(keys.wrapKey)
        expect(production.authPrivateKey).toEqual(keys.authPrivateKey)
      }
      return {
        passphrase_root: toHex(keys.passphraseRoot),
        auth_private_key: toHex(keys.authPrivateKey),
        auth_public_key: toHex(keys.authPublicKey),
        wrap_key: toHex(keys.wrapKey),
      }
    },

    wrapped_root(input) {
      const wrapKey = asWrapKey(bytes(input, 'wrap_key'))
      const accountPublicKey = asAccountPublicKey(
        bytes(input, 'account_public_key')
      )
      const rootEntropy = asRootEntropy(bytes(input, 'root_entropy'))
      const wrappedRoot = wrapRoot({
        wrapKey,
        nonce: asSealNonce(bytes(input, 'nonce')),
        accountPublicKey,
        rootEntropy,
      })
      // Sign-in also checks that the root gives this public key. That holds
      // only if the vector uses a matching pair.
      const derived = deriveAccountKeys(rootEntropy).accountPublicKey
      if (toHex(derived) === toHex(accountPublicKey)) {
        expect(
          unwrapRoot({ wrapKey, accountPublicKey, wrappedRoot }).rootEntropy
        ).toEqual(rootEntropy)
      } else {
        expect(open(wrapKey, accountPublicKey, wrappedRoot)).toEqual(
          rootEntropy
        )
      }
      return { wrapped_root: toHex(wrappedRoot) }
    },

    sign_in_signature(input) {
      const authPrivateKey = asAuthPrivateKey(bytes(input, 'auth_private_key'))
      const challenge = asChallenge(bytes(input, 'challenge'))
      const identifier = text(input, 'identifier_text')
      const signature = signInSignature({
        authPrivateKey,
        challenge,
        identifier,
      })
      expect(
        verifySignInSignature({
          authPublicKey: ed25519PublicKey<'auth_public_key'>(authPrivateKey),
          challenge,
          identifier,
          signature,
        })
      ).toBe(true)
      return {
        signature: toHex(signature),
        identifier_normalized_text: normalizeIdentifier(identifier),
      }
    },

    unlock_signature(input) {
      const authPrivateKey = asAuthPrivateKey(bytes(input, 'auth_private_key'))
      const authPublicKey = ed25519PublicKey<'auth_public_key'>(authPrivateKey)
      const challenge = asChallenge(bytes(input, 'challenge'))
      const identifier = text(input, 'identifier_text')
      const signature = unlockSignature({
        authPrivateKey,
        challenge,
        identifier,
      })
      expect(
        verifyUnlockSignature({
          authPublicKey,
          challenge,
          identifier,
          signature,
        })
      ).toBe(true)
      // The two requests have different context strings (section 6.3).
      expect(
        verifySignInSignature({
          authPublicKey,
          challenge,
          identifier,
          signature,
        })
      ).toBe(false)
      return {
        identifier_normalized_text: normalizeIdentifier(identifier),
        signature: toHex(signature),
      }
    },

    signed_request(input) {
      const accountPrivateKey = asAccountPrivateKey(
        bytes(input, 'account_private_key')
      )
      const request = {
        challenge: asChallenge(bytes(input, 'challenge')),
        method: text(input, 'method_text'),
        path: text(input, 'path_text'),
        body: bytes(input, 'body'),
      }
      const { signedMessage, signature } = signRequest({
        ...request,
        accountPrivateKey,
      })
      // The verifier accepts the method in upper case ASCII only. It does
      // not convert a different form.
      expect(
        verifySignedRequest({
          ...request,
          accountPublicKey:
            ed25519PublicKey<'account_public_key'>(accountPrivateKey),
          signature,
        })
      ).toBe(/^[A-Z]+$/.test(request.method))
      return {
        signed_message: toHex(signedMessage),
        signature: toHex(signature),
      }
    },

    file_keys(input) {
      const keys = deriveFileKeys(asFileKey(bytes(input, 'file_key')))
      return {
        content_cipher_key: toHex(keys.contentCipherKey),
        content_mac_key: toHex(keys.contentMacKey),
        metadata_key: toHex(keys.metadataKey),
        ocr_text_key: toHex(keys.ocrTextKey),
        thumbnail_key: toHex(keys.thumbnailKey),
        link_secret_key: toHex(keys.linkSecretKey),
      }
    },

    header(input) {
      const header = buildHeader(asNoncePrefix(bytes(input, 'nonce_prefix')))
      return {
        header: toHex(header),
        header_hash: toHex(parseHeader(header).headerHash),
      }
    },

    file_chunk(input) {
      const context = chunkContext(input)
      const chunkIndex = integer(input, 'chunk_index')
      const isFinal = boolean(input, 'is_final')
      const chunkPlaintext = bytes(input, 'chunk_plaintext')
      // Section 7.3 for one chunk. A vector can fix a short chunk that is
      // not final, which a writer never makes, so no length rule here.
      const storedChunk = encryptChunkUnchecked(
        context,
        chunkIndex,
        isFinal,
        chunkPlaintext
      )
      // Section 7.4, rules 6 and 8.
      const legalLength = isFinal
        ? chunkPlaintext.length <= CHUNK_SIZE &&
          (chunkPlaintext.length > 0 || chunkIndex === 0)
        : chunkPlaintext.length === CHUNK_SIZE
      if (legalLength) {
        expect(decryptChunk(context, chunkIndex, isFinal, storedChunk)).toEqual(
          chunkPlaintext
        )
      }
      return { stored_chunk: toHex(storedChunk) }
    },

    async file(input) {
      const fileKey = asFileKey(bytes(input, 'file_key'))
      const plaintext = mod251(integer(input, 'plaintext_length'))
      const hasher = blake3.create()
      const stored: Uint8Array[] = []
      let storedLength = 0
      for await (const part of encryptFile(
        fileKey,
        asNoncePrefix(bytes(input, 'nonce_prefix')),
        [plaintext]
      )) {
        hasher.update(part)
        stored.push(part)
        storedLength += part.length
      }
      expect(await collect(decryptFile(fileKey, stored))).toEqual(plaintext)
      return {
        stored_length: storedLength,
        stored_blake3: toHex(hasher.digest()),
      }
    },

    sealed_metadata(input) {
      const fileKey = asFileKey(bytes(input, 'file_key'))
      const headerHash = asHeaderHash(bytes(input, 'header_hash'))
      const fileMetadata = text(input, 'file_metadata_text')
      const sealedMetadata = sealFileMetadataBytes({
        fileKey,
        nonce: asSealNonce(bytes(input, 'nonce')),
        headerHash,
        fileMetadata: utf8(fileMetadata),
      })
      expect(openFileMetadata({ fileKey, headerHash, sealedMetadata })).toEqual(
        JSON.parse(fileMetadata)
      )
      return { sealed_metadata: toHex(sealedMetadata) }
    },

    sealed_ocr_text(input) {
      const fileKey = asFileKey(bytes(input, 'file_key'))
      const headerHash = asHeaderHash(bytes(input, 'header_hash'))
      const ocrText = text(input, 'ocr_text')
      const sealedOcrText = sealOcrText({
        fileKey,
        nonce: asSealNonce(bytes(input, 'nonce')),
        headerHash,
        ocrText,
      })
      expect(openOcrText({ fileKey, headerHash, sealedOcrText })).toBe(ocrText)
      return { sealed_ocr_text: toHex(sealedOcrText) }
    },

    sealed_thumbnail(input) {
      const fileKey = asFileKey(bytes(input, 'file_key'))
      const headerHash = asHeaderHash(bytes(input, 'header_hash'))
      const thumbnail = bytes(input, 'thumbnail')
      const sealedThumbnail = sealThumbnail({
        fileKey,
        nonce: asSealNonce(bytes(input, 'nonce')),
        headerHash,
        thumbnail,
      })
      expect(openThumbnail({ fileKey, headerHash, sealedThumbnail })).toEqual(
        thumbnail
      )
      return { sealed_thumbnail: toHex(sealedThumbnail) }
    },

    public_wrap(input) {
      return {
        stanza: toHex(
          publicWrap({
            recipientPublicKey: asFolderPublicKey(
              bytes(input, 'recipient_public_key')
            ),
            ephemeralPrivateKey: asEphemeralPrivateKey(
              bytes(input, 'ephemeral_private_key')
            ),
            context: text(input, 'context_text'),
            associatedData: bytes(input, 'associated_data'),
            secret: bytes(input, 'secret'),
          })
        ),
      }
    },

    account_stanza(input) {
      return {
        stanza: toHex(
          wrapAccountStanza({
            accountPublicKey: asAccountPublicKey(
              bytes(input, 'account_public_key')
            ),
            ephemeralPrivateKey: asEphemeralPrivateKey(
              bytes(input, 'ephemeral_private_key')
            ),
            headerHash: asHeaderHash(bytes(input, 'header_hash')),
            fileKey: asFileKey(bytes(input, 'file_key')),
          })
        ),
      }
    },

    async password_stanza(input) {
      const parameters = argon2idParameters(input)
      const fileKey = asFileKey(bytes(input, 'file_key'))
      const headerHash = asHeaderHash(bytes(input, 'header_hash'))
      const linkSecret = asLinkSecret(bytes(input, 'link_secret'))
      const wrapInput = {
        password: text(input, 'password_text'),
        passwordSalt: asPasswordSalt(bytes(input, 'password_salt')),
        linkSecret,
        ownerPublicKey: asAccountPublicKey(bytes(input, 'owner_public_key')),
        headerHash,
        fileKey,
        linkSecretNonce: asSealNonce(bytes(input, 'link_secret_nonce')),
        argon2id: nobleArgon2id,
      }
      const { passwordKey, stanza } =
        await wrapPasswordStanzaWithParametersForTestsOnly(
          wrapInput,
          parameters
        )
      const passwordKeyHex = toHex(passwordKey)
      expect(openSealedLinkSecret({ fileKey, headerHash, stanza })).toEqual(
        linkSecret
      )
      if (isRealKdf(parameters)) {
        // The function that a client calls takes no parameters and gives
        // the same stanza.
        expect(await wrapPasswordStanza(wrapInput)).toEqual(stanza)
      }
      expect(await unwrapPasswordStanzaOfVector(input, stanza)).toEqual(fileKey)
      return { password_key: passwordKeyHex, stanza: toHex(stanza) }
    },

    sealed_keyring(input) {
      const accountPrivateKey = asAccountPrivateKey(
        bytes(input, 'account_private_key')
      )
      const accountPublicKey = asAccountPublicKey(
        bytes(input, 'account_public_key')
      )
      const list = input.old_private_keys
      if (!Array.isArray(list)) {
        throw new Error('input "old_private_keys" must be an array')
      }
      if (list.length === 0) {
        throw new Error(
          'the schema has no sealed_keyring vector with an empty list'
        )
      }
      const oldPrivateKeys = list.map((entry: unknown) => {
        if (typeof entry !== 'string') {
          throw new Error('each old private key must be a hexadecimal string')
        }
        return asAccountPrivateKey(hexToBytes(entry))
      })
      const sealedKeyring = sealKeyring({
        accountPrivateKey,
        accountPublicKey,
        nonce: asSealNonce(bytes(input, 'nonce')),
        oldPrivateKeys,
      })
      expect(
        openKeyring({ accountPrivateKey, accountPublicKey, sealedKeyring })
      ).toEqual(oldPrivateKeys)
      return {
        keyring_key: toHex(deriveKeyringKey(accountPrivateKey)),
        sealed_keyring: toHex(sealedKeyring),
      }
    },

    folder(input) {
      const folderPrivateKey = asFolderPrivateKey(
        bytes(input, 'folder_private_key')
      )
      const accountPrivateKey = asAccountPrivateKey(
        bytes(input, 'account_private_key')
      )
      const folderMetadata = text(input, 'folder_metadata_text')
      const folderPublicKey = folderPublicKeyOf(folderPrivateKey)
      const sealedFolderMetadata = sealFolderMetadataBytes({
        folderPrivateKey,
        nonce: asSealNonce(bytes(input, 'metadata_nonce')),
        folderMetadata: utf8(folderMetadata),
      })
      const sealedFolderPrivateKey = sealFolderPrivateKey({
        accountPrivateKey,
        nonce: asSealNonce(bytes(input, 'private_key_nonce')),
        folderPrivateKey,
      })
      expect(
        openFolderMetadata({ folderPrivateKey, sealedFolderMetadata })
      ).toEqual(JSON.parse(folderMetadata))
      expect(
        openFolderPrivateKey({
          accountPrivateKey,
          folderPublicKey,
          sealedFolderPrivateKey,
        }).folderPrivateKey
      ).toEqual(folderPrivateKey)
      return {
        folder_public_key: toHex(folderPublicKey),
        folder_metadata_key: toHex(deriveFolderMetadataKey(folderPrivateKey)),
        sealed_folder_metadata: toHex(sealedFolderMetadata),
        folder_owner_key: toHex(deriveFolderOwnerKey(accountPrivateKey)),
        sealed_folder_private_key: toHex(sealedFolderPrivateKey),
      }
    },

    folder_stanzas(input) {
      const folderPublicKey = asFolderPublicKey(
        bytes(input, 'folder_public_key')
      )
      // Each stanza has its own ephemeral key. The schema has no
      // `ephemeral_private_key` for this procedure any more.
      if (Object.hasOwn(input, 'ephemeral_private_key')) {
        throw new Error(
          'folder_stanzas must not have one "ephemeral_private_key" for three stanzas'
        )
      }
      const ephemeralPrivateKeys = [
        bytes(input, 'file_ephemeral_private_key'),
        bytes(input, 'link_secret_ephemeral_private_key'),
        bytes(input, 'parent_ephemeral_private_key'),
      ].map(asEphemeralPrivateKey)
      expect(
        new Set(ephemeralPrivateKeys.map(toHex)).size,
        'one ephemeral key pair for each stanza'
      ).toBe(3)
      const headerHash = asHeaderHash(bytes(input, 'header_hash'))
      const childPrivateKey = asFolderPrivateKey(
        bytes(input, 'child_folder_private_key')
      )
      const childPublicKey = asFolderPublicKey(
        bytes(input, 'child_folder_public_key')
      )
      // The library calculates the public key of the child from its private
      // key (section 8.4.2). The vector must use a matching pair.
      expect(toHex(folderPublicKeyOf(childPrivateKey))).toBe(
        toHex(childPublicKey)
      )
      return {
        folder_file_stanza: toHex(
          wrapFolderFileStanza({
            folderPublicKey,
            ephemeralPrivateKey: ephemeralPrivateKeys[0],
            headerHash,
            fileKey: asFileKey(bytes(input, 'file_key')),
          })
        ),
        folder_link_secret_stanza: toHex(
          wrapFolderLinkSecretStanza({
            folderPublicKey,
            ephemeralPrivateKey: ephemeralPrivateKeys[1],
            headerHash,
            linkSecret: asLinkSecret(bytes(input, 'link_secret')),
          })
        ),
        parent_folder_stanza: toHex(
          wrapParentFolderStanza({
            parentFolderPublicKey: folderPublicKey,
            ephemeralPrivateKey: ephemeralPrivateKeys[2],
            folderPrivateKey: childPrivateKey,
          })
        ),
      }
    },

    tag(input) {
      const accountPrivateKey = asAccountPrivateKey(
        bytes(input, 'account_private_key')
      )
      const accountPublicKey = asAccountPublicKey(
        bytes(input, 'account_public_key')
      )
      const tagMetadata = text(input, 'tag_metadata_text')
      const sealedTagMetadata = sealTagMetadataBytes({
        accountPrivateKey,
        accountPublicKey,
        nonce: asSealNonce(bytes(input, 'nonce')),
        tagMetadata: utf8(tagMetadata),
      })
      expect(
        openTagMetadata({
          accountPrivateKey,
          accountPublicKey,
          sealedTagMetadata,
        })
      ).toEqual(JSON.parse(tagMetadata))
      return {
        tag_key: toHex(deriveTagKey(accountPrivateKey)),
        sealed_tag_metadata: toHex(sealedTagMetadata),
      }
    },

    encode_record(input) {
      const record = bytes(input, 'record')
      const storedRecord = encodeRecord(record)
      expect(decodeRecord(storedRecord)).toEqual(record)
      return { stored_record: toHex(storedRecord) }
    },
  }

// --- Vectors that the library must reject ---
//
// The schema says: each procedure that wraps or opens a stanza has vectors
// with the name `rejects ...` and the output `{ "error": true }`, and
// `file_chunk` has `decrypt_rejects` vectors with a `stored_chunk`.
//
// Each function here reads the inputs first and returns the call that must
// fail. An input that the test cannot read is thus an error of the test, not
// a rejection.
//
// The schema does not say how a `rejects` vector names its inputs. This test
// reads a vector with a `stanza` input as the open direction, with the
// private key of the recipient under `recipient_private_key`,
// `account_private_key` or `folder_private_key`, and each other vector as
// the wrap direction with the inputs of the table. For `folder_stanzas`,
// `stanza_kind_text` (`file`, `link_secret` or `parent`) selects the stanza.

type Rejection = () => unknown

function assertDirection(input: Fields, opens: boolean): void {
  if (Object.hasOwn(input, 'direction_text')) {
    expect(text(input, 'direction_text')).toBe(opens ? 'unwrap' : 'wrap')
  }
}

const REJECT_PROCEDURES: Record<string, (input: Fields) => Rejection> = {
  // Section 4.4, rule 11: a reader rejects a sealed empty list.
  sealed_keyring(input) {
    expect(text(input, 'direction_text')).toBe('open')
    const accountPrivateKey = asAccountPrivateKey(
      bytes(input, 'account_private_key')
    )
    const accountPublicKey = asAccountPublicKey(
      bytes(input, 'account_public_key')
    )
    const sealedKeyring = bytes(input, 'sealed_keyring')
    return () =>
      openKeyring({ accountPrivateKey, accountPublicKey, sealedKeyring })
  },

  file_chunk(input) {
    const context = chunkContext(input)
    const chunkIndex = integer(input, 'chunk_index')
    const isFinal = boolean(input, 'is_final')
    const storedChunk = bytes(input, 'stored_chunk')
    return () => decryptChunk(context, chunkIndex, isFinal, storedChunk)
  },

  public_wrap(input) {
    const opens = Object.hasOwn(input, 'stanza')
    assertDirection(input, opens)
    const context = text(input, 'context_text')
    const associatedData = bytes(input, 'associated_data')
    if (opens) {
      const recipientPrivateKey = asFolderPrivateKey(
        bytes(input, 'recipient_private_key')
      )
      const stanza = bytes(input, 'stanza')
      return () =>
        publicUnwrap({ recipientPrivateKey, context, associatedData, stanza })
    }
    // No branded constructor here: the key under test can be any 32 bytes.
    const recipientPublicKey = asFolderPublicKey(
      bytes(input, 'recipient_public_key')
    )
    const ephemeralPrivateKey = asEphemeralPrivateKey(
      bytes(input, 'ephemeral_private_key')
    )
    const secret = bytes(input, 'secret')
    return () =>
      publicWrap({
        recipientPublicKey,
        ephemeralPrivateKey,
        context,
        associatedData,
        secret,
      })
  },

  account_stanza(input) {
    const opens = Object.hasOwn(input, 'stanza')
    assertDirection(input, opens)
    const headerHash = asHeaderHash(bytes(input, 'header_hash'))
    if (opens) {
      const accountPrivateKey = asAccountPrivateKey(
        bytes(input, 'account_private_key')
      )
      const stanza = bytes(input, 'stanza')
      return () =>
        unwrapAccountStanza({ accountPrivateKey, headerHash, stanza })
    }
    const accountPublicKey = asAccountPublicKey(
      bytes(input, 'account_public_key')
    )
    const ephemeralPrivateKey = asEphemeralPrivateKey(
      bytes(input, 'ephemeral_private_key')
    )
    const fileKey = asFileKey(bytes(input, 'file_key'))
    return () =>
      wrapAccountStanza({
        accountPublicKey,
        ephemeralPrivateKey,
        headerHash,
        fileKey,
      })
  },

  password_stanza(input) {
    // A password stanza has no public key that the wrap can reject.
    assertDirection(input, true)
    const stanza = bytes(input, 'stanza')
    // Read each input now, so that only the unwrap can fail later.
    argon2idParameters(input)
    passwordUnwrapInput(input, stanza)
    return () => unwrapPasswordStanzaOfVector(input, stanza)
  },

  folder_stanzas(input) {
    const opens = Object.hasOwn(input, 'stanza')
    assertDirection(input, opens)
    const kind = text(input, 'stanza_kind_text')
    if (!['file', 'link_secret', 'parent'].includes(kind)) {
      throw new Error(`Unknown stanza_kind_text "${kind}"`)
    }
    if (opens) {
      const folderPrivateKey = asFolderPrivateKey(
        bytes(input, 'folder_private_key')
      )
      const stanza = bytes(input, 'stanza')
      if (kind === 'parent') {
        const folderPublicKey = asFolderPublicKey(
          bytes(input, 'child_folder_public_key')
        )
        return () =>
          unwrapParentFolderStanza({
            parentFolderPrivateKey: folderPrivateKey,
            folderPublicKey,
            stanza,
          })
      }
      const headerHash = asHeaderHash(bytes(input, 'header_hash'))
      return kind === 'file'
        ? () => unwrapFolderFileStanza({ folderPrivateKey, headerHash, stanza })
        : () =>
            unwrapFolderLinkSecretStanza({
              folderPrivateKey,
              headerHash,
              stanza,
            })
    }
    const folderPublicKey = asFolderPublicKey(bytes(input, 'folder_public_key'))
    if (kind === 'parent') {
      const ephemeralPrivateKey = asEphemeralPrivateKey(
        bytes(input, 'parent_ephemeral_private_key')
      )
      const folderPrivateKey = asFolderPrivateKey(
        bytes(input, 'child_folder_private_key')
      )
      return () =>
        wrapParentFolderStanza({
          parentFolderPublicKey: folderPublicKey,
          ephemeralPrivateKey,
          folderPrivateKey,
        })
    }
    const headerHash = asHeaderHash(bytes(input, 'header_hash'))
    if (kind === 'file') {
      const ephemeralPrivateKey = asEphemeralPrivateKey(
        bytes(input, 'file_ephemeral_private_key')
      )
      const fileKey = asFileKey(bytes(input, 'file_key'))
      return () =>
        wrapFolderFileStanza({
          folderPublicKey,
          ephemeralPrivateKey,
          headerHash,
          fileKey,
        })
    }
    const ephemeralPrivateKey = asEphemeralPrivateKey(
      bytes(input, 'link_secret_ephemeral_private_key')
    )
    const linkSecret = asLinkSecret(bytes(input, 'link_secret'))
    return () =>
      wrapFolderLinkSecretStanza({
        folderPublicKey,
        ephemeralPrivateKey,
        headerHash,
        linkSecret,
      })
  },
}

/**
 * The reasons that count as a rejection by the protocol. A failure with a
 * different reason, for example `invalid_encoding`, means that the vector
 * did not reach the rule that it is for.
 */
const STANZA_REJECT_REASONS: E2eeErrorReason[] = [
  'tag_mismatch',
  'non_canonical_public_key',
  'invalid_public_key',
  'low_order_point',
  'key_mismatch',
]
const REJECT_REASONS: Record<string, E2eeErrorReason[]> = {
  file_chunk: ['tag_mismatch', 'bad_length', 'empty_final_chunk', 'truncated'],
  public_wrap: STANZA_REJECT_REASONS,
  account_stanza: STANZA_REJECT_REASONS,
  password_stanza: STANZA_REJECT_REASONS,
  folder_stanzas: STANZA_REJECT_REASONS,
  sealed_keyring: ['bad_length'],
}

function isRejectVector(vector: Vector): boolean {
  return (
    typeof vector.output === 'object' &&
    vector.output !== null &&
    vector.output.error === true
  )
}

async function expectRejection(vector: Vector): Promise<void> {
  // Exact form: no other output key next to "error".
  expect(vector.output).toEqual(REJECTED)
  if (!Object.hasOwn(REJECT_PROCEDURES, vector.procedure)) {
    throw new Error(
      `The schema has no vector with "error" for "${vector.procedure}"`
    )
  }
  const rejection = REJECT_PROCEDURES[vector.procedure](vector.input)
  let result: unknown
  let thrown: unknown
  try {
    result = await rejection()
  } catch (error) {
    thrown = error
  }
  if (thrown === undefined) {
    const shown = result instanceof Uint8Array ? toHex(result) : String(result)
    throw new Error(`The library did not reject the input. It gave ${shown}`)
  }
  expect(thrown).toBeInstanceOf(E2eeError)
  expect(REJECT_REASONS[vector.procedure]).toContain(
    (thrown as E2eeError).reason
  )
}

/** Procedures that run Argon2id. Each needs one vector with the real parameters. */
const ARGON2_PROCEDURES = ['passphrase_keys', 'password_stanza']
/** Procedures that wrap or open a stanza. Each needs `rejects ...` vectors. */
const STANZA_PROCEDURES = [
  'public_wrap',
  'account_stanza',
  'password_stanza',
  'folder_stanzas',
]
const FILE_LENGTHS = [0, 1, 65535, 65536, 65537, 131072, 200000]

describe('test vectors of protocol version 1', () => {
  if (!existsSync(VECTORS_PATH)) {
    it.skip('SKIPPED: lib/e2ee/vectors/v1.json does not exist, so no test vector was checked', () => {})
    return
  }

  const file = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as {
    protocol_version?: unknown
    vectors?: unknown
  }
  const vectors = (Array.isArray(file.vectors) ? file.vectors : []) as Vector[]

  it('has the form of the schema', () => {
    expect(file.protocol_version).toBe(1)
    expect(Array.isArray(file.vectors)).toBe(true)
    expect(vectors.length).toBeGreaterThan(0)
    for (const vector of vectors) {
      expect(typeof vector.procedure).toBe('string')
      expect(typeof vector.name).toBe('string')
      expect(vector.input).toBeTypeOf('object')
      expect(vector.output).toBeTypeOf('object')
    }
  })

  it('names only procedures that the schema lists', () => {
    const unknown = vectors
      .map((vector) => vector.procedure)
      .filter((procedure) => !Object.hasOwn(PROCEDURES, procedure))
    expect(unknown).toEqual([])
  })

  it('names each vector with "error" as the schema says, and no other vector', () => {
    for (const vector of vectors) {
      const prefix =
        vector.procedure === 'file_chunk' ? 'decrypt_rejects' : 'rejects '
      expect
        .soft(
          vector.name.startsWith(prefix),
          `${vector.procedure}: "${vector.name}" starts with "${prefix}"`
        )
        .toBe(isRejectVector(vector))
    }
  })

  it('has enough vectors for each procedure', () => {
    const count = (procedure: string) =>
      vectors.filter(
        (vector) => vector.procedure === procedure && !isRejectVector(vector)
      )
    const rejects = (procedure: string) =>
      vectors.filter(
        (vector) => vector.procedure === procedure && isRejectVector(vector)
      )
    for (const procedure of Object.keys(PROCEDURES)) {
      expect
        .soft(count(procedure).length, `vectors of ${procedure}`)
        .toBeGreaterThanOrEqual(2)
    }
    for (const procedure of ARGON2_PROCEDURES) {
      const real = count(procedure).filter(
        (vector) =>
          vector.input.memory_kib === 65536 &&
          vector.input.passes === 3 &&
          vector.input.lanes === 4
      )
      expect
        .soft(real.length, `${procedure} with the real Argon2id parameters`)
        .toBeGreaterThanOrEqual(1)
      expect
        .soft(count(procedure).length, `vectors of ${procedure}`)
        .toBeGreaterThanOrEqual(3)
    }
    const lengths = count('file').map((vector) => vector.input.plaintext_length)
    for (const length of FILE_LENGTHS) {
      expect.soft(lengths, 'plaintext_length of file vectors').toContain(length)
    }
    for (const procedure of STANZA_PROCEDURES) {
      expect
        .soft(rejects(procedure).length, `"rejects" vectors of ${procedure}`)
        .toBeGreaterThanOrEqual(1)
    }
    // A zero-length final chunk after a full chunk: the stored chunk is a
    // tag only, it is final, and it is not chunk 0.
    const emptyFinal = rejects('file_chunk').filter(
      (vector) =>
        vector.input.is_final === true &&
        vector.input.chunk_index !== 0 &&
        typeof vector.input.stored_chunk === 'string' &&
        vector.input.stored_chunk.length === 64
    )
    expect
      .soft(emptyFinal.length, 'decrypt_rejects of a zero-length final chunk')
      .toBeGreaterThanOrEqual(1)
    expect.soft(rejects('file'), '"error" vectors of file').toEqual([])
    const emptyKeyrings = vectors.filter(
      (vector) =>
        vector.procedure === 'sealed_keyring' &&
        !isRejectVector(vector) &&
        Array.isArray(vector.input.old_private_keys) &&
        vector.input.old_private_keys.length === 0
    )
    expect.soft(emptyKeyrings, 'sealed_keyring with an empty list').toEqual([])
  })

  it.each(vectors.map((vector, index) => ({ index, vector })))(
    'vector $index ($vector.procedure): $vector.name',
    async ({ vector }) => {
      if (!Object.hasOwn(PROCEDURES, vector.procedure)) {
        throw new Error(`Unknown procedure "${vector.procedure}"`)
      }
      if (isRejectVector(vector)) {
        await expectRejection(vector)
        return
      }
      const actual = await PROCEDURES[vector.procedure](vector.input)
      // Exact equality: a missing or an extra output key fails too.
      expect(actual).toEqual(vector.output)
    },
    ARGON2_TIMEOUT
  )
})
