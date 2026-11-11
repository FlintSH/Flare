import { type OpenedFolder, openOwnedFolder } from '@/lib/e2ee/client/folders'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import { nameKey } from '@/lib/library/names'

import type { FolderView } from './schema'

/**
 * The owner's view of the folders of the account: the browser opens the key
 * and the name of each folder that has keys (docs/e2ee-spec.md, section
 * 8.4.2). Opened keys stay in memory only, for as long as the account keys
 * that opened them.
 */

/** What a folder is called while this browser cannot open its name. */
export const LOCKED_FOLDER_NAME = 'Encrypted folder'

type Opened = { signature: string; folder: OpenedFolder | null }

// One cache per unlocked account record. It goes when the keys go.
const caches = new WeakMap<StoredAccountKeys, Map<string, Opened>>()

function signature(view: FolderView) {
  const keys = view.keys!
  return `${keys.folderPublicKey}.${keys.sealedFolderMetadata}.${keys.sealedFolderPrivateKey}`
}

/**
 * The opened keys of one folder, or null when the account key does not open
 * them: a record that was changed, or keys of a different account.
 */
export function ownedFolderKeys(
  view: FolderView,
  keys: StoredAccountKeys
): OpenedFolder | null {
  if (!view.keys) return null
  let cache = caches.get(keys)
  if (!cache) caches.set(keys, (cache = new Map()))
  const known = cache.get(view.id)
  const current = signature(view)
  if (known?.signature === current) return known.folder
  let folder: OpenedFolder | null = null
  try {
    folder = openOwnedFolder(keys.accountPrivateKey, view.keys)
  } catch {
    folder = null
  }
  cache.set(view.id, { signature: current, folder })
  return folder
}

/** A folder view with the name that this browser can show for it. */
export interface OwnedFolderView extends FolderView {
  /** The folder has keys and this browser did not open them. */
  locked?: boolean
}

/**
 * The folders with their names opened, in the order of those names. The
 * server cannot sort sealed names, so the client does (section 9.4.2).
 */
export function ownedFolderViews(
  views: readonly FolderView[],
  keys: StoredAccountKeys | null
): OwnedFolderView[] {
  return views
    .map((view): OwnedFolderView => {
      if (!view.keys) return view
      const opened = keys ? ownedFolderKeys(view, keys) : null
      return opened
        ? { ...view, name: opened.name }
        : { ...view, name: LOCKED_FOLDER_NAME, locked: true }
    })
    .sort(
      (a, b) =>
        nameKey(a.name).localeCompare(nameKey(b.name)) ||
        a.id.localeCompare(b.id)
    )
}

/** Whether a sibling of the same parent already has this name, ignoring case. */
export function folderNameTaken(
  folders: readonly FolderView[],
  name: string,
  parentId: string | null,
  exceptId?: string
): boolean {
  const key = nameKey(name)
  return folders.some(
    (folder) =>
      folder.id !== exceptId &&
      folder.parentId === parentId &&
      nameKey(folder.name) === key
  )
}
