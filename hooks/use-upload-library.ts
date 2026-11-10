'use client'

import { useCallback } from 'react'

import { makeThumbnail } from '@/lib/files/thumbnail-client'
import { ownedFolderKeys } from '@/lib/folders/owned'
import { requestMaintenance } from '@/lib/library/browser-maintenance'
import { rememberLocalFile } from '@/lib/library/local-files'
import { matchingRuleTagIds } from '@/lib/tags/owned'
import {
  type UploadLibrary,
  type UploadOptions,
  isReadableImage,
} from '@/lib/uploads/client'

import { useFolders } from '@/hooks/use-folders'
import { useTags } from '@/hooks/use-tags'

/**
 * What this browser does for the library around each upload
 * (docs/e2ee-spec.md, section 10.1, steps 5 and 7): the folder stanza of a
 * public file, the tag rules of the owner and a thumbnail. Work that is
 * left goes to the background queue once the file is stored.
 */
export function useUploadLibrary() {
  const { folders, keys } = useFolders()
  const { tags, loading: tagsLoading, error: tagsError } = useTags()
  // Rules can run only when this browser read every tag. Otherwise the
  // upload says that no rule ran, and the background work applies them.
  const rulesReady =
    !tagsLoading && !tagsError && !tags.some((tag) => tag.locked)
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
        // A WebP thumbnail of an image or of a video's first frame, which
        // the upload seals (section 12.1).
        thumbnail: (file: File) => makeThumbnail(file, file.type),
        ...(rulesReady && {
          // The rules on the name. A rule on image text runs once the text
          // is read (docs/e2ee-spec.md, section 9.7).
          ruleTagIds: (name: string) =>
            matchingRuleTagIds(
              tags.filter((tag) => tag.ruleSource === 'filename'),
              { name }
            ),
        }),
        uploaded({ id, file, plain }) {
          // The text of a new image is read from the file this page still
          // holds, after the upload, so the link is ready at once.
          if (!plain && isReadableImage(file.type)) rememberLocalFile(id, file)
          // A file whose visibility the server chose may still need its
          // folder stanza, and every upload can leave work for this browser.
          requestMaintenance('folders', 'index', 'pending')
        },
      }
    },
    [folders, keys, tags, rulesReady]
  )
}
