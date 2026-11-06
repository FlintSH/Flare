import type { ArchiveFormat } from '@/lib/archives/shared'

export interface FileViewerFile {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  userId: string
  archiveFormat?: ArchiveFormat | null
  /** Highlighting for text/plain files, from the real filename. */
  textLanguage?: string
}

export interface FileViewerUrls {
  fileUrl: string
  directUrl?: string
}

export interface FileViewerState {
  urls?: FileViewerUrls
  content?: string
  isLoading: boolean
  error?: string
}

export interface FileViewerContext {
  file: FileViewerFile
  verifiedPassword?: string
  state: FileViewerState
  fetchContent: () => Promise<void>
  fetchDirectUrl: () => Promise<void>
}

export interface FileViewerProps {
  file: FileViewerFile
  verifiedPassword?: string
}
