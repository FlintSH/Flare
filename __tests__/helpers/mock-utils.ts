import { NextResponse } from 'next/server'

/**
 * Create a mock NextResponse with proper status and json properties
 */
export function createMockResponse<T = any>(
  data: T,
  options: { status?: number; headers?: Record<string, string> } = {}
) {
  const status = options.status || 200
  const headers = options.headers || {}

  // Create a response that works with Jest expectations
  const response = {
    status,
    headers,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }

  return response
}

/**
 * Create a mock implementation for an API route
 */
export function createRouteHandlerMock<T = any>(data: T, status = 200) {
  return jest
    .fn()
    .mockImplementation(() => createMockResponse(data, { status }))
}
