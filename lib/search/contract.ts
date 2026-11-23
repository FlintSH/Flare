/**
 * What Find asks the server and what it gets back. The dashboard bundles
 * this module, so it imports only types.
 */
import type { FileType } from '@/types/components/file'

import type { ShortLink } from '@/lib/links/schema'

/** Results per group. */
export const FIND_LIMIT = 5
/** Shorter queries aren't sent. */
export const FIND_MINIMUM = 2
/** Text found in images is searched from this many characters. */
export const FIND_OCR_MINIMUM = 3
export const FIND_MAXIMUM = 200

export interface FoundFolder {
  id: string
  name: string
  parentId: string | null
}

/** Each group is null when the account may not list it. */
export interface FindResults {
  files: FileType[] | null
  links: ShortLink[] | null
  folders: FoundFolder[] | null
}
