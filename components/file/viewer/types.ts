export interface FileViewerFile {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  userId: string
}

export interface FileViewerUrls {
  fileUrl: string
  rawUrl: string
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
