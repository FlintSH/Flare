import { blake3 } from '@noble/hashes/blake3.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  deriveAccountKeys,
  deriveKeyringKey,
  derivePassphraseKeys,
  mnemonicFromRootEntropy,
  openKeyring,
  rootEntropyFromMnemonic,
  sealKeyring,
  signInSignature,
  signRequest,
  unwrapRoot,
  verifySignInSignature,
  verifySignedRequest,
  wrapRoot,
} from './account'
import { nobleArgon2id } from './argon2-noble'
import {
  CHUNK_SIZE,
  buildHeader,
  contentContext,
  decryptChunk,
  decryptFile,
  deriveFileKeys,
  encryptFile,
  parseHeader,
} from './file'
import { type KdfParameters, V1_KDF_PARAMETERS } from './kdf'
import {
  blake3DeriveKey,
  blake3KeyedHash,
  bytesToHex,
  ed25519PublicKey,
  hexToBytes,
  utf8,
} from './primitives'
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
} from './records'
import { open, seal } from './seal'
import {
  openSealedLinkSecret,
  publicWrap,
  unwrapPasswordStanza,
  wrapAccountStanza,
  wrapFolderFileStanza,
  wrapFolderLinkSecretStanza,
  wrapParentFolderStanza,
  wrapPasswordStanza,
} from './stanza'
import { collect, mod251 } from './test-support'
import {
  derivePassphraseKeysForTestsOnly,
  encryptChunkUnchecked,
  unwrapPasswordStanzaForTestsOnly,
  wrapPasswordStanzaForTestsOnly,
} from './testing'
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
} from './types'

/**
 * Checks every vector of `vectors/v1.json` against the library. The schema
 * is `vectors/SCHEMA.md`. A separate reference program makes the file from
 * the specification, so this test is skipped while the file does not exist.
 */

const VECTORS_PATH = fileURLToPath(
  new URL('./vectors/v1.json', import.meta.url)
)
const ARGON2_TIMEOUT = 300_000

type Fields = Record<string, unknown>
type Output = Record<string, string | number>

interface Vector {
  procedure: string
  name: string
  input: Fields
  output: Fields
}

// --- Readers that follow the naming rules of the schema ---

function bytes(fields: Fields, key: string): Uint8Array {
  const value = fields[key]
  if (typeof value !== 'string') {
    throw new Error(`input "${key}" must be a hexadecimal string`)
  }
  return hexToBytes(value)
}

function text(fields: Fields, key: string): string {
  if (!key.endsWith('_text')) throw new Error(`"${key}" is not a text key`)
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

function kdfParameters(fields: Fields): KdfParameters {
  return {
    memoryKib: integer(fields, 'memory_kib'),
    passes: integer(fields, 'passes'),
    lanes: integer(fields, 'lanes'),
  }
}

function isRealKdf(parameters: KdfParameters): boolean {
  return (
    parameters.memoryKib === V1_KDF_PARAMETERS.memoryKib &&
    parameters.passes === V1_KDF_PARAMETERS.passes &&
    parameters.lanes === V1_KDF_PARAMETERS.lanes
  )
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
      const parameters = kdfParameters(input)
      const derivation = {
        passphrase: text(input, 'passphrase_text'),
        passphraseSalt: asPassphraseSalt(bytes(input, 'passphrase_salt')),
        kdfParameters: parameters,
        argon2id: nobleArgon2id,
      }
      const keys = await derivePassphraseKeysForTestsOnly(derivation)
      if (isRealKdf(parameters)) {
        // The function that a client calls at sign-in gives the same keys.
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
      return { signature: toHex(signature) }
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
      expect(
        verifySignedRequest({
          ...request,
          accountPublicKey:
            ed25519PublicKey<'account_public_key'>(accountPrivateKey),
          signature,
        })
      ).toBe(true)
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
      const context = contentContext(
        asFileKey(bytes(input, 'file_key')),
        buildHeader(asNoncePrefix(bytes(input, 'nonce_prefix')))
      )
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
      const legalLength = isFinal
        ? chunkPlaintext.length <= CHUNK_SIZE
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
      const parameters = kdfParameters(input)
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
      const unwrapInput = {
        password: wrapInput.password,
        linkSecret,
        headerHash,
        argon2id: nobleArgon2id,
      }
      const { passwordKey, stanza } = await wrapPasswordStanzaForTestsOnly(
        wrapInput,
        parameters
      )
      const passwordKeyHex = toHex(passwordKey)
      expect(openSealedLinkSecret({ fileKey, headerHash, stanza })).toEqual(
        linkSecret
      )
      if (isRealKdf(parameters)) {
        // The functions that a client calls give and open the same stanza.
        expect(await wrapPasswordStanza(wrapInput)).toEqual(stanza)
        expect(await unwrapPasswordStanza({ ...unwrapInput, stanza })).toEqual(
          fileKey
        )
      } else {
        expect(
          await unwrapPasswordStanzaForTestsOnly(
            { ...unwrapInput, stanza },
            parameters
          )
        ).toEqual(fileKey)
      }
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
      const ephemeralPrivateKey = asEphemeralPrivateKey(
        bytes(input, 'ephemeral_private_key')
      )
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
      // The same ephemeral key serves all three stanzas in a vector.
      return {
        folder_file_stanza: toHex(
          wrapFolderFileStanza({
            folderPublicKey,
            ephemeralPrivateKey,
            headerHash,
            fileKey: asFileKey(bytes(input, 'file_key')),
          })
        ),
        folder_link_secret_stanza: toHex(
          wrapFolderLinkSecretStanza({
            folderPublicKey,
            ephemeralPrivateKey,
            headerHash,
            linkSecret: asLinkSecret(bytes(input, 'link_secret')),
          })
        ),
        parent_folder_stanza: toHex(
          wrapParentFolderStanza({
            parentFolderPublicKey: folderPublicKey,
            ephemeralPrivateKey,
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

/** Procedures that run Argon2id. Each needs one vector with the real parameters. */
const ARGON2_PROCEDURES = ['passphrase_keys', 'password_stanza']
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

  it('has enough vectors for each procedure', () => {
    const count = (procedure: string) =>
      vectors.filter((vector) => vector.procedure === procedure)
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
  })

  it.each(vectors.map((vector, index) => ({ index, vector })))(
    'vector $index ($vector.procedure): $vector.name',
    async ({ vector }) => {
      if (!Object.hasOwn(PROCEDURES, vector.procedure)) {
        throw new Error(`Unknown procedure "${vector.procedure}"`)
      }
      const actual = await PROCEDURES[vector.procedure](vector.input)
      // Exact equality: a missing or an extra output key fails too.
      expect(actual).toEqual(vector.output)
    },
    ARGON2_TIMEOUT
  )
})
