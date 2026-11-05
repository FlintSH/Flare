export interface FileMetadata {
  id: string
  name: string
  urlPath: string
  mimeType: string
  size: number
  uploadedAt: Date
  visibility: string
  views: number
  downloads: number
  hasPassword: boolean
  expiresAt?: Date | null
}

export interface FileTypesResponse {
  types: string[]
}
