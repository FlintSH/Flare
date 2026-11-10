import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import { folderRequestBody } from '@/lib/folders/client'
import { type OwnedFolderView, ownedFolderKeys } from '@/lib/folders/owned'
import type { FolderView } from '@/lib/folders/schema'

import type { ExtractionFolder, MakeExtractionFolders } from './jobs'

/**
 * The account folders of an extraction that runs in the browser
 * (docs/e2ee-spec.md, section 12.3): one new folder that holds everything,
 * as the server makes for a plain archive, and one for each folder of the
 * archive. The owner's page makes them. Each has its own key pair and a
 * sealed name (section 8.4.2), so the server gets no folder name of the
 * archive (section 12.3.1, rule 4), and each folder below another has its
 * parent stanza, so a shared folder link above opens it (section 9.4.3).
 *
 * Folders are made one after the other, parents first. `made` is told of
 * each one, so a caller can remove them if nothing was extracted.
 */
export function extractionFolderMaker(input: {
  /** The name of the new folder that holds everything. */
  name: string
  /** Where that folder goes. Null: the top level. */
  parentId: string | null
  /** The folders of the account, with the names this browser opened. */
  folders: readonly OwnedFolderView[]
  keys: StoredAccountKeys
  /** `POST /api/folders` with the body of one new folder. */
  create(body: Record<string, unknown>): Promise<FolderView>
  made?(folder: FolderView): void
}): MakeExtractionFolders {
  return async (planned) => {
    const known: OwnedFolderView[] = [...input.folders]
    const result = new Map<string, ExtractionFolder>()
    const make = async (
      path: string,
      name: string,
      parentId: string | null
    ) => {
      const view = await input.create(
        folderRequestBody({ name, parentId, folders: known, keys: input.keys })
      )
      input.made?.(view)
      // The public key comes from the private key that the account key
      // opens, never from the copy of the server (section 8.4.2).
      const opened = ownedFolderKeys(view, input.keys)
      known.push({ ...view, name: opened?.name ?? name })
      result.set(path, {
        id: view.id,
        folderPublicKey: opened?.folderPublicKey ?? null,
      })
    }
    await make('', input.name, input.parentId)
    for (const folder of planned) {
      const parent = result.get(folder.parentPath)
      if (!parent) throw new Error('A folder of the archive has no parent.')
      await make(folder.path, folder.name, parent.id)
    }
    return result
  }
}
