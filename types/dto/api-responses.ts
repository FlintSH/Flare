/**
 * Common API response types for application
 */

// Basic API response structure
export interface ApiResponse<T> {
  data: T
  success: boolean
  error?: string
}

// Pagination metadata
export interface PaginationMeta {
  total: number
  pageCount: number
  page: number
  limit: number
}

// Paginated API response
export interface PaginatedApiResponse<T> extends ApiResponse<T> {
  pagination: PaginationMeta
}

// Error response
export interface ApiErrorResponse {
  error: string
  success: false
}
