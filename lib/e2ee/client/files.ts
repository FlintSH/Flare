import { E2eeError, isE2eeError } from '../errors'
import { headerHash, parseHeader } from '../file'
import type { Argon2id } from '../kdf'
import type { ShareSecret } from '../link'
import {
  base64urlDecode,
  base64urlEncode,
  ed2curvePrivate,
  wipe,
  x25519PublicKey,
} from '../primitives'
import {
  createRandomFile,
  sealFileMetadataWithRandomNonce,
  wrapAccountStanzaWithRandomKey,
  wrapRandomPasswordStanza,
} from '../random'
import {
  decodeStoredRecord,
  encodeStoredRecord,
  jsonValue,
  openFileMetadata,
} from '../records'
import {
  openSealedLinkSecret,
  unwrapAccountStanza,
  unwrapAccountStanzaWithSharedSecret,
  unwrapPasswordStanza,
} from '../stanza'
import type {
  AccountPrivateKey,
  AccountPublicKey,
  ExchangePublicKey,
  FileHeader,
  FileKey,
  HeaderHash,
  LinkSecret,
  NoncePrefix,
} from '../types'
import { asAccountPublicKey, asFileKey } from '../types'
import { type NativeX25519, importNativeX25519 } from './native-x25519'

/**
 * What the browser does with the records of an encrypted file
 * (docs/e2ee-spec.md, sections 8.1, 8.2, 9.1 and 10). The server stores the
 * records and never a key. Everything here runs in the client.
 */

/** The records of one file as the server sends them: base64url, with `record_version`. */
export interface EncryptedRecordsWire {
  readonly header: string
  readonly sealedMetadata: string
  readonly passwordStanza?: string | null
  /** Only in an answer to the owner. */
  readonly accountStanza?: string | null
  readonly stanzaAccountPublicKey?: string | null
}

/** A file that this client has the key of. `name` and `type` are not trusted text. */
export interface OpenedFile {
  readonly fileKey: FileKey
  readonly headerHash: HeaderHash
  /** As the uploader wrote it. Show and save it only through `safeFileName`. */
  readonly name: string
  /** As the uploader wrote it. Select a renderer only through `safeRendering`. */
  readonly type: string
}

const NAME_MAX_LENGTH = 1024

function fileHeaderHash(records: EncryptedRecordsWire): HeaderHash {
  const header = base64urlDecode(records.header)
  parseHeader(header)
  return headerHash(header)
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value
    ? value.slice(0, NAME_MAX_LENGTH)
    : fallback
}

/**
 * Opens `sealed_metadata` with a `file_key`. This is also the test of the
 * key: a key that is not the key of this file fails with `tag_mismatch`.
 */
export function openWithFileKey(
  records: EncryptedRecordsWire,
  fileKey: FileKey
): OpenedFile {
  asFileKey(fileKey)
  const hash = fileHeaderHash(records)
  const metadata = openFileMetadata({
    fileKey,
    headerHash: hash,
    sealedMetadata: decodeStoredRecord(
      'sealed_metadata',
      base64urlDecode(records.sealedMetadata)
    ),
  })
  return {
    fileKey,
    headerHash: hash,
    name: text(jsonValue(metadata, 'name'), 'file'),
    type: text(jsonValue(metadata, 'type'), 'application/octet-stream'),
  }
}

/** The private keys of an account, ready to open stanzas. Erase with `close`. */
export interface AccountUnwrapper {
  unwrap(records: EncryptedRecordsWire): Promise<OpenedFile>
  close(): void
}

interface UnwrapKey {
  readonly accountPrivateKey: AccountPrivateKey
  readonly exchangePublicKey: ExchangePublicKey
  readonly native: NativeX25519 | null
}

/**
 * Opens account stanzas with the current private key and then the old keys
 * of the keyring, newest first (section 8.3.4). X25519 uses the function of
 * the browser where there is one (section 9.8.3) and the library otherwise.
 * `useNative: false` forces the library, for the test that compares both.
 */
export async function createAccountUnwrapper(
  keys: {
    readonly accountPrivateKey: Uint8Array
    readonly oldPrivateKeys: readonly Uint8Array[]
  },
  { useNative = true }: { useNative?: boolean } = {}
): Promise<AccountUnwrapper> {
  const unwrapKeys: UnwrapKey[] = []
  for (const key of [keys.accountPrivateKey, ...keys.oldPrivateKeys]) {
    const accountPrivateKey = key.slice() as AccountPrivateKey
    const exchangePrivateKey = ed2curvePrivate(accountPrivateKey)
    try {
      unwrapKeys.push({
        accountPrivateKey,
        exchangePublicKey:
          x25519PublicKey<'exchange_public_key'>(exchangePrivateKey),
        native: useNative ? await importNativeX25519(exchangePrivateKey) : null,
      })
    } finally {
      wipe(exchangePrivateKey)
    }
  }

  async function fileKeyWith(
    key: UnwrapKey,
    stanza: Uint8Array,
    hash: HeaderHash
  ): Promise<FileKey> {
    if (key.native) {
      const sharedSecret = await key.native.sharedSecret(stanza.subarray(0, 32))
      if (sharedSecret)
        try {
          return unwrapAccountStanzaWithSharedSecret({
            sharedSecret,
            exchangePublicKey: key.exchangePublicKey,
            headerHash: hash,
            stanza,
          })
        } finally {
          wipe(sharedSecret)
        }
      // The browser refused the pair. The library decides what is wrong.
    }
    return unwrapAccountStanza({
      accountPrivateKey: key.accountPrivateKey,
      headerHash: hash,
      stanza,
    })
  }

  return {
    async unwrap(records) {
      if (!records.accountStanza)
        throw new E2eeError(
          'invalid_argument',
          'The file has no account stanza'
        )
      const hash = fileHeaderHash(records)
      const stanza = decodeStoredRecord(
        'account_stanza',
        base64urlDecode(records.accountStanza)
      )
      let failure: unknown = new E2eeError('tag_mismatch', 'No key opens it')
      for (const key of unwrapKeys) {
        try {
          return openWithFileKey(records, await fileKeyWith(key, stanza, hash))
        } catch (error) {
          // A stanza for a different key fails with `tag_mismatch`. Each
          // other failure is a defect of the record: stop.
          if (!isE2eeError(error) || error.reason !== 'tag_mismatch')
            throw error
          failure = error
        }
      }
      throw failure
    },
    close() {
      for (const key of unwrapKeys) wipe(key.accountPrivateKey)
      unwrapKeys.length = 0
    },
  }
}

/** Section 8.2, unwrap: the secret of the link and the password give the key. */
export async function openWithPassword(input: {
  readonly records: EncryptedRecordsWire
  readonly linkSecret: LinkSecret
  readonly password: string
  readonly argon2id: Argon2id
}): Promise<OpenedFile> {
  const { records } = input
  if (!records.passwordStanza)
    throw new E2eeError('invalid_argument', 'The file has no password stanza')
  const hash = fileHeaderHash(records)
  const fileKey = await unwrapPasswordStanza({
    password: input.password,
    linkSecret: input.linkSecret,
    headerHash: hash,
    stanza: decodeStoredRecord(
      'password_stanza',
      base64urlDecode(records.passwordStanza)
    ),
    argon2id: input.argon2id,
  })
  return openWithFileKey(records, fileKey)
}

/**
 * What the share link of a file carries (section 10.3): `link_secret` if
 * the file has a password stanza, from the sealed copy that `file_key`
 * opens, and `file_key` if it has none.
 */
export function shareSecretOf(
  opened: OpenedFile,
  passwordStanza: string | null | undefined
): ShareSecret {
  if (!passwordStanza) return { kind: 'file_key', fileKey: opened.fileKey }
  return {
    kind: 'link_secret',
    linkSecret: openSealedLinkSecret({
      fileKey: opened.fileKey,
      headerHash: opened.headerHash,
      stanza: decodeStoredRecord(
        'password_stanza',
        base64urlDecode(passwordStanza)
      ),
    }),
  }
}

/** A new password stanza for a file this client has the key of (section 8.2). */
export async function newPasswordStanza(input: {
  readonly opened: Pick<OpenedFile, 'fileKey' | 'headerHash'>
  readonly password: string
  readonly ownerPublicKey: Uint8Array
  readonly argon2id: Argon2id
}): Promise<{ passwordStanza: string; secret: ShareSecret }> {
  const { linkSecret, stanza } = await wrapRandomPasswordStanza({
    password: input.password,
    ownerPublicKey: asAccountPublicKey(input.ownerPublicKey),
    headerHash: input.opened.headerHash,
    fileKey: input.opened.fileKey,
    argon2id: input.argon2id,
  })
  return {
    passwordStanza: base64urlEncode(
      encodeStoredRecord('password_stanza', stanza)
    ),
    secret: { kind: 'link_secret', linkSecret },
  }
}

/** What one upload needs before its content is encrypted (section 10.1, steps 1, 2 and 4). */
export interface NewEncryptedFile {
  readonly fileKey: FileKey
  readonly noncePrefix: NoncePrefix
  readonly header: FileHeader
  readonly headerHash: HeaderHash
  /** What the upload request sends. None of it is secret. */
  readonly records: {
    readonly header: string
    readonly sealedMetadata: string
    readonly accountStanza: string
    readonly stanzaAccountPublicKey: string
  }
}

export function newEncryptedFile(input: {
  readonly name: string
  readonly type: string
  readonly accountPublicKey: Uint8Array
}): NewEncryptedFile {
  const accountPublicKey = asAccountPublicKey(
    input.accountPublicKey
  ) as AccountPublicKey
  const { fileKey, noncePrefix, header } = createRandomFile()
  const hash = headerHash(header)
  return {
    fileKey,
    noncePrefix,
    header,
    headerHash: hash,
    records: {
      header: base64urlEncode(header),
      sealedMetadata: base64urlEncode(
        encodeStoredRecord(
          'sealed_metadata',
          sealFileMetadataWithRandomNonce({
            fileKey,
            headerHash: hash,
            metadata: { name: input.name, type: input.type },
          })
        )
      ),
      accountStanza: base64urlEncode(
        encodeStoredRecord(
          'account_stanza',
          wrapAccountStanzaWithRandomKey({
            accountPublicKey,
            headerHash: hash,
            fileKey,
          })
        )
      ),
      stanzaAccountPublicKey: base64urlEncode(accountPublicKey),
    },
  }
}
