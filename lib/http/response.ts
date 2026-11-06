import { NextResponse } from 'next/server'

import type {
  ApiResponse,
  PaginatedApiResponse,
  PaginationMeta,
} from '@/types/dto/api-responses'

export function apiResponse<T>(data: T): NextResponse<ApiResponse<T>> {
  return NextResponse.json({
    data,
    success: true,
  })
}

export function paginatedResponse<T>(
  data: T,
  pagination: PaginationMeta
): NextResponse<PaginatedApiResponse<T>> {
  return NextResponse.json({
    data,
    pagination,
    success: true,
  })
}
