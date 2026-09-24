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
  folderId?: string | null
  tags?: { id: string; name: string }[]
}

export interface PaginationInfo {
  total: number
  pageCount: number
  page: number
  limit: number
  /** Exact image offset for a gallery window anchored to the current file. */
  offset?: number
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
  folder?: string | null
  tag?: string | null
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
