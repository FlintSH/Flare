export interface ApiResponse<T> {
  data: T
  success: boolean
  error?: string
}

export interface PaginationMeta {
  /** First image's zero-based position; the anchor's position for empty results. */
  offset?: number
  total: number
  pageCount: number
  page: number
  limit: number
}

export interface PaginatedApiResponse<T> extends ApiResponse<T> {
  pagination: PaginationMeta
}

export interface ApiErrorResponse {
  error: string
  success: false
}
