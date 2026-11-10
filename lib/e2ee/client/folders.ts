import { E2eeError } from '../errors'
import { headerHash, parseHeader } from '../file'
import { type ShareSecret, shareFragment } from '../link'
import {
  base64urlDecode,
  base64urlEncode,
  constantTimeEqual,
  wipe,
} from '../primitives'
import {
  generateFolderPrivateKey,
  sealFolderMetadataWithRandomNonce,
  sealFolderPrivateKeyWithRandomNonce,
  wrapFolderFileStanzaWithRandomKey,
  wrapFolderLinkSecretStanzaWithRandomKey,
  wrapParentFolderStanzaWithRandomKey,
} from '../random'
import {
  decodeStoredRecord,
  encodeStoredRecord,
  folderPublicKeyOf,
  jsonValue,
  openFolderMetadata,
  openFolderPrivateKey,
} from '../records'
import {
  openSealedLinkSecret,
  unwrapFolderFileStanza,
  unwrapFolderLinkSecretStanza,
  unwrapParentFolderStanza,
} from '../stanza'
import type {
  AccountPrivateKey,
  FileKey,
  FolderPrivateKey,
  FolderPublicKey,
  HeaderHash,
} from '../types'
import { asFolderPublicKey } from '../types'
import { type OpenedFile, openWithFileKey } from './files'

/**
 * What a browser does with the keys of a folder (docs/e2ee-spec.md,
 * sections 8.4 and 9.4). The owner opens a folder with the account private
 * key. A visitor opens it with the private key that the shared link carries
 * after `#`. The server stores the records and never a private key.
 *
 * A client never encrypts to a `folder_public_key` that the server gave: it
 * calculates the public key from the private key that it opened (section
 * 8.4.2), and a record that names a different key is rejected.
 */

/** The key records of a folder as the server sends them: base64url, with `record_version`. */
export interface FolderKeysWire {
  readonly folderPublicKey: string
  readonly sealedFolderMetadata: string
  readonly sealedFolderPrivateKey?: string
  readonly parentFolderStanza?: string | null
}

/** A folder that this client has the private key of. `name` is not trusted text. */
export interface OpenedFolder {
  readonly folderPrivateKey: FolderPrivateKey
  /** Calculated from the private key. Never the copy of the server. */
  readonly folderPublicKey: FolderPublicKey
  readonly name: string
}

/** Longer than any name the application writes. A longer one is cut for display. */
const NAME_MAX_LENGTH = 255
/** What a folder is called when its sealed name has no text. */
export const UNNAMED_FOLDER = 'Folder'

function listedPublicKey(keys: FolderKeysWire): FolderPublicKey {
  return asFolderPublicKey(
    base64urlDecode(keys.folderPublicKey)
  ) as FolderPublicKey
}

function openName(
  folderPrivateKey: FolderPrivateKey,
  keys: FolderKeysWire
): string {
  const metadata = openFolderMetadata({
    folderPrivateKey,
    sealedFolderMetadata: decodeStoredRecord(
      'sealed_folder_metadata',
      base64urlDecode(keys.sealedFolderMetadata)
    ),
  })
  const name = jsonValue(metadata, 'name')
  return typeof name === 'string' && name
    ? name.slice(0, NAME_MAX_LENGTH)
    : UNNAMED_FOLDER
}

/**
 * Opens a folder with a private key that the client already has: the key of
 * a shared link. The key must give the public key of the record, else
 * `key_mismatch`: the link is for a different folder or an older key.
 */
export function openFolderWithKey(
  keys: FolderKeysWire,
  folderPrivateKey: FolderPrivateKey
): OpenedFolder {
  const folderPublicKey = folderPublicKeyOf(folderPrivateKey)
  if (!constantTimeEqual(folderPublicKey, listedPublicKey(keys)))
    throw new E2eeError(
      'key_mismatch',
      'The folder private key does not give the folder public key'
    )
  return {
    folderPrivateKey: folderPrivateKey.slice() as FolderPrivateKey,
    folderPublicKey,
    name: openName(folderPrivateKey, keys),
  }
}

/** The owner's way in: `sealed_folder_private_key`, which only the account key opens. */
export function openOwnedFolder(
  accountPrivateKey: Uint8Array,
  keys: FolderKeysWire
): OpenedFolder {
  if (!keys.sealedFolderPrivateKey)
    throw new E2eeError('invalid_argument', 'The folder has no sealed key')
  const { folderPrivateKey, folderPublicKey } = openFolderPrivateKey({
    accountPrivateKey: accountPrivateKey as AccountPrivateKey,
    folderPublicKey: listedPublicKey(keys),
    sealedFolderPrivateKey: decodeStoredRecord(
      'sealed_folder_private_key',
      base64urlDecode(keys.sealedFolderPrivateKey)
    ),
  })
  return {
    folderPrivateKey,
    folderPublicKey,
    name: openName(folderPrivateKey, keys),
  }
}

/** A folder below one that is open: its private key is in `parent_folder_stanza`. */
export function openChildFolder(
  parent: Pick<OpenedFolder, 'folderPrivateKey'>,
  keys: FolderKeysWire
): OpenedFolder {
  if (!keys.parentFolderStanza)
    throw new E2eeError('invalid_argument', 'The folder has no parent stanza')
  const folderPrivateKey = unwrapParentFolderStanza({
    parentFolderPrivateKey: parent.folderPrivateKey,
    folderPublicKey: listedPublicKey(keys),
    stanza: decodeStoredRecord(
      'parent_folder_stanza',
      base64urlDecode(keys.parentFolderStanza)
    ),
  })
  return {
    folderPrivateKey,
    folderPublicKey: folderPublicKeyOf(folderPrivateKey),
    name: openName(folderPrivateKey, keys),
  }
}

/** What the server stores for a folder that the owner's browser made keys for. */
export interface NewFolderRecords {
  readonly folderPublicKey: string
  readonly sealedFolderMetadata: string
  readonly sealedFolderPrivateKey: string
}

/**
 * Steps 1 to 4 of section 8.4.2: a new key pair, the sealed name and the
 * owner's sealed copy of the private key. Also the new keys of a folder
 * whose sharing stopped (section 9.4.5).
 */
export function newFolderKeys(
  accountPrivateKey: Uint8Array,
  name: string
): { opened: OpenedFolder; records: NewFolderRecords } {
  const folderPrivateKey = generateFolderPrivateKey()
  const folderPublicKey = folderPublicKeyOf(folderPrivateKey)
  return {
    opened: { folderPrivateKey, folderPublicKey, name },
    records: {
      folderPublicKey: base64urlEncode(folderPublicKey),
      sealedFolderMetadata: sealedFolderName({ folderPrivateKey }, name),
      sealedFolderPrivateKey: sealedFolderKey(accountPrivateKey, {
        folderPrivateKey,
      }),
    },
  }
}

/** A new `sealed_folder_metadata`: how the owner renames a folder. */
export function sealedFolderName(
  folder: Pick<OpenedFolder, 'folderPrivateKey'>,
  name: string
): string {
  return base64urlEncode(
    encodeStoredRecord(
      'sealed_folder_metadata',
      sealFolderMetadataWithRandomNonce({
        folderPrivateKey: folder.folderPrivateKey,
        metadata: { name },
      })
    )
  )
}

/**
 * `sealed_folder_private_key` for an account private key. A rotation makes
 * one for each folder with the new account key (section 8.3.3).
 */
export function sealedFolderKey(
  accountPrivateKey: Uint8Array,
  folder: Pick<OpenedFolder, 'folderPrivateKey'>
): string {
  return base64urlEncode(
    encodeStoredRecord(
      'sealed_folder_private_key',
      sealFolderPrivateKeyWithRandomNonce({
        accountPrivateKey: accountPrivateKey as AccountPrivateKey,
        folderPrivateKey: folder.folderPrivateKey,
      })
    )
  )
}

/**
 * Step 5 of section 8.4.2: the private key of `folder`, encrypted to the
 * public key of `parent`, with that key in the form the server compares.
 */
export function parentStanzaFor(
  folder: Pick<OpenedFolder, 'folderPrivateKey'>,
  parent: Pick<OpenedFolder, 'folderPublicKey'>
): { parentFolderStanza: string; parentFolderPublicKey: string } {
  return {
    parentFolderStanza: base64urlEncode(
      encodeStoredRecord(
        'parent_folder_stanza',
        wrapParentFolderStanzaWithRandomKey({
          parentFolderPublicKey: parent.folderPublicKey,
          folderPrivateKey: folder.folderPrivateKey,
        })
      )
    ),
    parentFolderPublicKey: base64urlEncode(parent.folderPublicKey),
  }
}

/**
 * The folder stanza of a public file (section 8.4.3): `folder_file_stanza`
 * with `file_key`, or `folder_link_secret_stanza` with `link_secret` when
 * the file has a password stanza. `passwordStanza` is the stored one, from
 * which the owner gets `link_secret` back.
 */
export function folderStanzaFor(
  folder: Pick<OpenedFolder, 'folderPublicKey'>,
  file: { readonly fileKey: FileKey; readonly headerHash: HeaderHash },
  secret: ShareSecret
): { folderStanza: string; folderPublicKey: string } {
  const stanza =
    secret.kind === 'link_secret'
      ? encodeStoredRecord(
          'folder_link_secret_stanza',
          wrapFolderLinkSecretStanzaWithRandomKey({
            folderPublicKey: folder.folderPublicKey,
            headerHash: file.headerHash,
            linkSecret: secret.linkSecret,
          })
        )
      : encodeStoredRecord(
          'folder_file_stanza',
          wrapFolderFileStanzaWithRandomKey({
            folderPublicKey: folder.folderPublicKey,
            headerHash: file.headerHash,
            fileKey: file.fileKey,
          })
        )
  return {
    folderStanza: base64urlEncode(stanza),
    folderPublicKey: base64urlEncode(folder.folderPublicKey),
  }
}

/** The secret that a folder stanza of `file` carries: see `folderStanzaFor`. */
export function folderSecretOf(
  file: { readonly fileKey: FileKey; readonly headerHash: HeaderHash },
  passwordStanza: string | null | undefined
): ShareSecret {
  if (!passwordStanza) return { kind: 'file_key', fileKey: file.fileKey }
  return {
    kind: 'link_secret',
    linkSecret: openSealedLinkSecret({
      fileKey: file.fileKey,
      headerHash: file.headerHash,
      stanza: decodeStoredRecord(
        'password_stanza',
        base64urlDecode(passwordStanza)
      ),
    }),
  }
}

/** A file of a shared folder as a visitor's browser opened it. */
export type OpenedFolderFile =
  /** The folder gave `file_key`: the name is known and the link opens the file. */
  | {
      readonly kind: 'file'
      readonly opened: OpenedFile
      readonly fragment: string
    }
  /** The folder gave `link_secret`: the file's page asks for the password. */
  | { readonly kind: 'password'; readonly fragment: string }

/**
 * Opens the folder stanza of one listed file with the private key of its
 * folder (section 9.4.3, step 2). `fragment` is what the file's own share
 * link carries after `#` (section 10.3): a visitor of the folder has that
 * link for each file in the list.
 */
export function openFolderFile(
  folder: Pick<OpenedFolder, 'folderPrivateKey'>,
  file: {
    readonly header: string
    readonly sealedMetadata: string
    readonly folderStanza: string
    readonly hasPassword: boolean
  }
): OpenedFolderFile {
  const header = base64urlDecode(file.header)
  parseHeader(header)
  const hash = headerHash(header)
  if (file.hasPassword) {
    const linkSecret = unwrapFolderLinkSecretStanza({
      folderPrivateKey: folder.folderPrivateKey,
      headerHash: hash,
      stanza: decodeStoredRecord(
        'folder_link_secret_stanza',
        base64urlDecode(file.folderStanza)
      ),
    })
    try {
      return {
        kind: 'password',
        fragment: shareFragment({ kind: 'link_secret', linkSecret }),
      }
    } finally {
      wipe(linkSecret)
    }
  }
  const fileKey = unwrapFolderFileStanza({
    folderPrivateKey: folder.folderPrivateKey,
    headerHash: hash,
    stanza: decodeStoredRecord(
      'folder_file_stanza',
      base64urlDecode(file.folderStanza)
    ),
  })
  const opened = openWithFileKey(file, fileKey)
  return {
    kind: 'file',
    opened,
    fragment: shareFragment({ kind: 'file_key', fileKey }),
  }
}
