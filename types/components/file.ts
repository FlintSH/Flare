import type { ExpiryAction } from '@/types/events'

import type { EncryptedRecordsWire } from '@/lib/e2ee/client/files'

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
  /**
   * The browser encrypted this file. The server sends no name and no type
   * for it: `name` is empty and `mimeType` is the generic type until the
   * client opens `encryption` with the account key.
   */
  encrypted?: boolean
  encryption?: EncryptedRecordsWire | null
}
