'use client'

import { useCallback } from 'react'

import { ownedFolderKeys } from '@/lib/folders/owned'
import { requestMaintenance } from '@/lib/library/browser-maintenance'
import type { UploadLibrary, UploadOptions } from '@/lib/uploads/client'

import { useFolders } from '@/hooks/use-folders'

/**
 * What this browser does for the library around each upload
 * (docs/e2ee-spec.md, section 10.1, steps 5 and 7): the folder stanza of a
 * public file, the tag rules of the owner and a thumbnail. Work that is
 * left goes to the background queue once the file is stored.
 */
export function useUploadLibrary() {
  const { folders, keys } = useFolders()
  return useCallback(
    (options: UploadOptions): UploadLibrary => {
      const view = options.folderId
        ? folders.find((folder) => folder.id === options.folderId)
        : undefined
      const folder =
        view?.keys && !view.keys.rekeyPending && keys
          ? ownedFolderKeys(view, keys)
          : null
      return {
        folder,
        uploaded() {
          // A file whose visibility the server chose may still need its
          // folder stanza, and every upload can leave work for this browser.
          requestMaintenance('folders', 'index', 'pending')
        },
      }
    },
    [folders, keys]
  )
}
