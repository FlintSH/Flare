/**
 * Helper function to create a standardized API response for tests
 */
export function createApiResponse(
  data: any,
  options: { success?: boolean; status?: number } = {}
) {
  const { success = true, status = success ? 200 : 400 } = options

  // Create a response object that mimics what our API would return
  const responseBody = success
    ? { data, success: true }
    : { error: data, success: false }

  // Create a response object with status property for tests
  return {
    status,
    json: async () => responseBody,
    headers: {},
  }
}

/**
 * Helper to create paginated API responses for tests
 */
export function createPaginatedApiResponse(
  data: any[],
  options: {
    page?: number
    limit?: number
    total?: number
    success?: boolean
    status?: number
  } = {}
) {
  const {
    page = 1,
    limit = 25,
    total = data.length,
    success = true,
    status = 200,
  } = options

  const pageCount = Math.ceil(total / limit) || 1

  // Create a response object with pagination
  const responseBody = {
    data,
    pagination: {
      page,
      limit,
      total,
      pageCount,
    },
    success,
  }

  // Return response object with status
  return {
    status,
    json: async () => responseBody,
    headers: {},
  }
}
