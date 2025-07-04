import { NextResponse } from 'next/server'

import {
  ApiErrorResponse,
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

export function apiError(
  message: string,
  status: number = 400
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      error: message,
      success: false,
    },
    { status }
  )
}

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
}
