import type {
  AccountUnwrapper,
  EncryptedRecordsWire,
} from '@/lib/e2ee/client/files'
import {
  folderSecretOf,
  folderStanzaFor,
  newFolderKeys,
  parentStanzaFor,
} from '@/lib/e2ee/client/folders'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'

import { ownedFolderKeys } from './owned'
import type { FolderView } from './schema'

/**
 * The key material that the owner's browser makes for the folders of the
 * account (docs/e2ee-spec.md, sections 8.4, 9.4.4 and 9.4.5). The server
 * lists what is missing and this procedure makes it:
 *
 * 1. a key pair for each folder from before encryption, which also seals
 *    its name, and a new key pair for each folder whose sharing stopped,
 * 2. a parent stanza for each folder whose parent has a different key now,
 * 3. a folder stanza for each public encrypted file without one for the
 *    current key of its folder.
 *
 * It is safe to run at any time and to stop at any step: each request
 * leaves the account valid, and the next run continues.
 */

export interface RepairFile extends EncryptedRecordsWire {
  readonly id: string
  readonly folderId: string
}

export interface FolderRepairs {
  readonly folderKeys: string[]
  readonly parentStanzas: { id: string; parentId: string }[]
  readonly fileStanzas: RepairFile[]
  readonly more: boolean
}

/** The requests of the procedure, so a test can run it against a store in memory. */
export interface RepairsApi {
  folders(): Promise<FolderView[]>
  repairs(after?: string): Promise<FolderRepairs>
  putKeys(body: {
    folders?: unknown[]
    parentStanzas?: unknown[]
  }): Promise<unknown>
  putFileStanzas(body: {
    stanzas: unknown[]
  }): Promise<{ stored: number; skipped: string[] }>
}

export interface RepairResult {
  folderKeys: number
  parentStanzas: number
  fileStanzas: number
}

/** Each round stores something, so a tree this deep in rounds never ends by the limit. */
const MAX_ROUNDS = 100
const KEY_BATCH = 100

export async function repairFolders(
  api: RepairsApi,
  keys: StoredAccountKeys,
  unwrapper: AccountUnwrapper,
  { signal }: { signal?: AbortSignal } = {}
): Promise<RepairResult> {
  const result: RepairResult = {
    folderKeys: 0,
    parentStanzas: 0,
    fileStanzas: 0,
  }

  // Folder keys first, then the stanzas between folders: a stanza is for
  // the key that its folder has at that time.
  for (let round = 0; round < MAX_ROUNDS; round++) {
    signal?.throwIfAborted()
    const [views, repairs] = await Promise.all([api.folders(), api.repairs()])
    const byId = new Map(views.map((view) => [view.id, view]))

    const folders = repairs.folderKeys.slice(0, KEY_BATCH).flatMap((id) => {
      const view = byId.get(id)
      if (!view) return []
      // A folder from before encryption has a plain name. A folder that
      // gets new keys has its name sealed with the old ones.
      const name = view.keys ? ownedFolderKeys(view, keys)?.name : view.name
      if (name === undefined) return []
      return [{ id, ...newFolderKeys(keys.accountPrivateKey, name).records }]
    })
    if (folders.length) {
      await api.putKeys({ folders })
      result.folderKeys += folders.length
      continue
    }

    const parentStanzas = repairs.parentStanzas
      .slice(0, KEY_BATCH)
      .flatMap(({ id, parentId }) => {
        const child = byId.get(id)
        const parent = byId.get(parentId)
        const opened = child && ownedFolderKeys(child, keys)
        const openedParent = parent && ownedFolderKeys(parent, keys)
        return opened && openedParent
          ? [{ id, ...parentStanzaFor(opened, openedParent) }]
          : []
      })
    if (parentStanzas.length) {
      await api.putKeys({ parentStanzas })
      result.parentStanzas += parentStanzas.length
      continue
    }
    break
  }

  // Folder stanzas of files, a page at a time. `after` moves past a file
  // that this browser cannot open, so one bad record never stops the rest.
  const views = await api.folders()
  const byId = new Map(views.map((view) => [view.id, view]))
  let after: string | undefined
  for (let round = 0; round < MAX_ROUNDS * 100; round++) {
    signal?.throwIfAborted()
    const repairs = await api.repairs(after)
    const stanzas: unknown[] = []
    for (const file of repairs.fileStanzas) {
      const view = byId.get(file.folderId)
      const folder = view && ownedFolderKeys(view, keys)
      if (!folder) continue
      try {
        const opened = await unwrapper.unwrap(file)
        stanzas.push({
          fileId: file.id,
          ...folderStanzaFor(
            folder,
            opened,
            folderSecretOf(opened, file.passwordStanza)
          ),
        })
      } catch {
        // No key of the account opens this file. It gets no folder stanza.
      }
    }
    if (stanzas.length)
      result.fileStanzas += (await api.putFileStanzas({ stanzas })).stored
    if (!repairs.more || !repairs.fileStanzas.length) break
    after = repairs.fileStanzas[repairs.fileStanzas.length - 1].id
  }
  return result
}
