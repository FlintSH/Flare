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
  /**
   * No key of the account opens this encrypted file: its keys were reset
   * without the recovery phrase (docs/e2ee-spec.md, section 6.9).
   */
  unreadable?: boolean
  /** Work that waits for the owner's browser (section 9.7). */
  thumbnailPending?: boolean
  ocrPending?: boolean
  /**
   * The server encrypted this file, which had a server-side password. It is
   * private until its owner sets a password again or shares it (section 14.2).
   */
  passwordPending?: boolean
}
