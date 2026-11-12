import type { FileKind, FileKindInfo } from '@/lib/files/file-kind'

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
  /** In bytes; sizes the loading state of a text preview. */
  size?: number
} & FileKindInfo

/**
 * Kinds without a preview to give room to: their share page is a small card
 * with the file's name, an audio player if there is one, and its actions.
 */
export function isCompactKind(kind: FileKind) {
  return kind === 'audio' || kind === 'other' || kind === 'unsupported-archive'
}
