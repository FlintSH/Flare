import type { FileKindInfo } from '@/lib/files/file-kind'

/** The kind comes from the real filename, which `name` may hide. */
export type FileViewerFile = {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  userId: string
} & FileKindInfo

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
