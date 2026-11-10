import {
  newFolderKeys,
  parentStanzaFor,
  sealedFolderName,
} from '@/lib/e2ee/client/folders'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'

import { type OwnedFolderView, folderNameTaken, ownedFolderKeys } from './owned'
import { folderNameSchema } from './schema'

/**
 * The request body of a new or renamed folder, made in the owner's browser
 * (docs/e2ee-spec.md, sections 8.4.2 and 9.4.4). For an account that has
 * keys, the name is sealed here and the server never gets it. The checks
 * that the server did on a plain name happen here too: the form of the
 * name, and that no sibling has it already (section 9.4.2).
 *
 * `keys` is null while the browser is locked. An account whose folders have
 * keys then cannot change them, and the error says so.
 */
export function folderRequestBody(input: {
  name: string
  /** The folder to rename. Without one, the body is for a new folder. */
  existing?: OwnedFolderView | null
  /** The parent of a new folder. */
  parentId?: string | null
  folders: readonly OwnedFolderView[]
  keys: StoredAccountKeys | null
}): Record<string, unknown> {
  const { existing, folders, keys } = input
  const parsed = folderNameSchema.safeParse(input.name)
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid folder name.')
  const name = parsed.data
  const parentId = existing ? existing.parentId : (input.parentId ?? null)
  if (folderNameTaken(folders, name, parentId, existing?.id))
    throw new Error('A folder with that name already exists here.')
  if (!keys) {
    if (existing?.keys || folders.some((folder) => folder.keys))
      throw new Error('Unlock your encryption keys to change folders.')
    return existing ? { name } : { name, parentId }
  }
  if (existing) {
    const opened = existing.keys ? ownedFolderKeys(existing, keys) : null
    if (!opened)
      throw new Error(
        'This folder is still getting its keys. Try again in a moment.'
      )
    return { sealedFolderMetadata: sealedFolderName(opened, name) }
  }
  const made = newFolderKeys(keys.accountPrivateKey, name)
  const parent = folders.find((folder) => folder.id === parentId)
  const parentKeys =
    parent?.keys && !parent.keys.rekeyPending
      ? ownedFolderKeys(parent, keys)
      : null
  return {
    parentId,
    ...made.records,
    // Without it, the background work adds the stanza once the parent has
    // its keys.
    ...(parentKeys && parentStanzaFor(made.opened, parentKeys)),
  }
}
