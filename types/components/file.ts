export interface FileType {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  size: number
  uploadedAt: string
  views: number
  downloads: number
}

export interface PaginationInfo {
  total: number
  pageCount: number
  page: number
  limit: number
}

export type SortOption = 'newest' | 'oldest' | 'largest' | 'smallest'

export interface FileFilterOptions {
  page: number
  limit: number
  search: string
  sortBy: SortOption
  types: string[]
  visibility: string[]
  dateFrom: string | null
  dateTo: string | null
}

export interface FileFilter {
  search: string
  types: string[]
  visibility: string[]
  dateFrom: string | null
  dateTo: string | null
}
