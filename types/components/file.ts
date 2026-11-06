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
  folderId?: string | null
  tags?: { id: string; name: string }[]
}
