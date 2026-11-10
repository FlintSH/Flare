import { accountKeysFromPrivateKey } from '../account'
import { E2eeError } from '../errors'
import { base64urlEncode, constantTimeEqual, wipe } from '../primitives'
import {
  sealKeyringWithRandomNonce,
  wrapAccountStanzaWithRandomKey,
} from '../random'
import { encodeStoredRecord } from '../records'
import type { AccountPrivateKey, AccountPublicKey } from '../types'
import type { AccountUnwrapper, EncryptedRecordsWire } from './files'
import {
  type FolderKeysWire,
  openOwnedFolder,
  sealedFolderKey,
} from './folders'
import { openTagRecord, sealedTagRecord } from './tags'

/**
 * What a key rotation does for the library, in the client
 * (docs/e2ee-spec.md, sections 8.3.3 and 8.3.4): it seals each folder key
 * and each tag record again for the new account key, in the rotation
 * request itself, and later moves each account stanza from an old key to
 * the current one, in the background.
 */

interface KeyPair {
  readonly accountPrivateKey: Uint8Array
  readonly accountPublicKey: Uint8Array
}

export interface SealedLibrary {
  readonly folders: readonly (FolderKeysWire & { readonly id: string })[]
  readonly tags: readonly { readonly id: string; readonly sealed: string }[]
}

export interface RotatedLibraryWire {
  folders: { id: string; sealedFolderPrivateKey: string }[]
  tags: { id: string; sealedTagMetadata: string }[]
}

/**
 * A new `sealed_folder_private_key` for each folder and a new
 * `sealed_tag_metadata` for each tag (section 8.3.3, step 6). The key pairs
 * of the folders and the content of the tags do not change. A record that
 * the old key does not open stops the rotation: the server would otherwise
 * keep a record that no key of the account opens.
 */
export function resealLibrary(
  oldKeys: KeyPair,
  newKeys: KeyPair,
  library: SealedLibrary
): RotatedLibraryWire {
  return {
    folders: library.folders.map((folder) => {
      const opened = openOwnedFolder(oldKeys.accountPrivateKey, folder)
      try {
        return {
          id: folder.id,
          sealedFolderPrivateKey: sealedFolderKey(
            newKeys.accountPrivateKey,
            opened
          ),
        }
      } finally {
        wipe(opened.folderPrivateKey)
      }
    }),
    tags: library.tags.map((tag) => ({
      id: tag.id,
      sealedTagMetadata: sealedTagRecord(
        newKeys,
        openTagRecord(oldKeys, tag.sealed)
      ),
    })),
  }
}

export interface OldStanza extends EncryptedRecordsWire {
  readonly id: string
}

export interface OldStanzas {
  readonly stanzas: OldStanza[]
  readonly remaining: number
  /** The old account public keys that still have a stanza, base64url. */
  readonly oldKeys: string[]
}

/** The requests of the migration, so a test can run it against a store in memory. */
export interface MigrationApi {
  oldStanzas(after?: string): Promise<OldStanzas>
  replace(body: {
    stanzaAccountPublicKey: string
    stanzas: { id: string; accountStanza: string }[]
  }): Promise<{ replaced: number }>
  /** A signed request (section 6.6): `null` stores no keyring. */
  replaceKeyring(sealedKeyring: Uint8Array | null): Promise<void>
}

export interface MigrationResult {
  migrated: number
  /** The old private keys that stay in the keyring, newest first. */
  oldPrivateKeys: Uint8Array[]
  /** Whether the keyring on the server was replaced. */
  pruned: boolean
}

/**
 * Section 8.3.4: moves every account stanza that is for an old key to the
 * current key, a batch at a time, then stores a keyring without the old
 * keys that have no stanza left. It can stop at any batch and continue in
 * a later session: the server holds all of its state.
 */
export async function migrateStanzas(
  api: MigrationApi,
  keys: KeyPair & { readonly oldPrivateKeys: readonly Uint8Array[] },
  unwrapper: AccountUnwrapper,
  {
    signal,
    onProgress,
  }: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  } = {}
): Promise<MigrationResult> {
  const current = keys.accountPublicKey as AccountPublicKey
  const currentText = base64urlEncode(current)
  let migrated = 0
  let total: number | null = null
  let after: string | undefined
  let state: OldStanzas
  for (;;) {
    signal?.throwIfAborted()
    state = await api.oldStanzas(after)
    total ??= state.remaining
    if (!state.stanzas.length) break
    const stanzas: { id: string; accountStanza: string }[] = []
    for (const stanza of state.stanzas)
      try {
        const opened = await unwrapper.unwrap(stanza)
        stanzas.push({
          id: stanza.id,
          accountStanza: base64urlEncode(
            encodeStoredRecord(
              'account_stanza',
              wrapAccountStanzaWithRandomKey({
                accountPublicKey: current,
                headerHash: opened.headerHash,
                fileKey: opened.fileKey,
              })
            )
          ),
        })
        wipe(opened.fileKey)
      } catch {
        // No key of this browser opens the stanza. It stays, and so does
        // the old key that it is for.
      }
    if (stanzas.length) {
      migrated += (
        await api.replace({ stanzaAccountPublicKey: currentText, stanzas })
      ).replaced
      onProgress?.(migrated, total)
    }
    // Past this batch: what could not be opened is not asked for again.
    after = state.stanzas[state.stanzas.length - 1].id
  }
  // A last look at every stanza, then the keyring without the keys that
  // have none left (step 5).
  const left = new Set((await api.oldStanzas()).oldKeys)
  const oldPrivateKeys = keys.oldPrivateKeys.filter((privateKey) => {
    const pair = accountKeysFromPrivateKey(privateKey as AccountPrivateKey)
    wipe(pair.exchangePrivateKey)
    return left.has(base64urlEncode(pair.accountPublicKey))
  })
  const pruned = oldPrivateKeys.length !== keys.oldPrivateKeys.length
  if (pruned)
    await api.replaceKeyring(
      oldPrivateKeys.length
        ? sealKeyringWithRandomNonce({
            accountPrivateKey: keys.accountPrivateKey as AccountPrivateKey,
            accountPublicKey: current,
            oldPrivateKeys: oldPrivateKeys as AccountPrivateKey[],
          })
        : null
    )
  return { migrated, oldPrivateKeys: [...oldPrivateKeys], pruned }
}

/** Whether a private key gives a public key. For a caller that checks stored keys. */
export function isKeyPair(keys: KeyPair): boolean {
  try {
    const pair = accountKeysFromPrivateKey(
      keys.accountPrivateKey as AccountPrivateKey
    )
    wipe(pair.exchangePrivateKey)
    return constantTimeEqual(pair.accountPublicKey, keys.accountPublicKey)
  } catch (error) {
    if (error instanceof E2eeError) return false
    throw error
  }
}
