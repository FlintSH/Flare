export interface FileType {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  hasPassword: boolean
  /** Legacy responses may include this; use hasPassword for display state. */
  password?: string | null
  size: number
  uploadedAt: string
  views: number
  downloads: number
  expiresAt?: string | null
}

export interface PaginationInfo {
  total: number
  pageCount: number
  page: number
  limit: number
}

export type SortOption =
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'most-viewed'
  | 'least-viewed'
  | 'most-downloaded'
  | 'least-downloaded'

export type FileGrouping = 'none' | 'week' | 'month' | 'year'

export interface FileFilterOptions {
  groupBy: FileGrouping
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
