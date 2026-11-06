import type { FileKindInfo } from '@/lib/files/file-kind'

/**
 * A file the share page lets the visitor see. Its kind comes from the real
 * filename, which `name` may hide.
 */
export type FileViewerFile = {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
} & FileKindInfo
