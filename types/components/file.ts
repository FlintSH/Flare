import type { ExpiryAction } from '@/types/events'

import type { FileMatch, FileSearchIndexInfo } from '@/lib/search/contract'

export interface FileType {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  hasPassword: boolean
  size: number
  uploadedAt: string
  views: number
  downloads: number
  expiresAt?: string | null
  /** What the pending expiration does; null without one. */
  expiryAction?: ExpiryAction | null
  folderId?: string | null
  tags?: { id: string; name: string }[]
  /** What search could read from the file's contents. */
  searchIndex?: FileSearchIndexInfo | null
  /** Why the file matched; only in search results. */
  match?: FileMatch | null
}
