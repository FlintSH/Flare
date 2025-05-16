import { getServerSession } from 'next-auth'

// Add Jest types
declare global {
  namespace jest {
    interface Mock<T = any, Y extends any[] = any[]> extends Function {
      (...args: Y): T
      mock: MockContext<T, Y>
    }
  }
}

// Mock NextRequest
class MockNextRequest {
  url: string
  method: string
  headers: Headers
  body: any

  constructor(
    url: string,
    options: {
      method: string
      headers: Headers
      body: any
    }
  ) {
    this.url = url
    this.method = options.method
    this.headers = options.headers
    this.body = options.body
  }

  // Mock methods that API handlers might use
  async json() {
    return this.body ? JSON.parse(this.body) : null
  }
}

/**
 * Creates a mock request for testing API routes
 */
export function createRequest(options: {
  method?: string
  url?: string
  body?: any
  headers?: Record<string, string>
}): MockNextRequest {
  const {
    method = 'GET',
    url = 'http://localhost:3000',
    body,
    headers = {},
  } = options

  // Create headers with content type if body is an object
  const reqHeaders = new Headers(headers)
  if (body && typeof body === 'object') {
    reqHeaders.set('Content-Type', 'application/json')
  }

  // Initialize the request
  return new MockNextRequest(url, {
    method,
    headers: reqHeaders,
    body: body
      ? typeof body === 'object'
        ? JSON.stringify(body)
        : body
      : null,
  })
}

/**
 * Mock authenticated session for testing
 */
export function mockAuthSession(user: {
  id: string
  name?: string
  email?: string
  role: 'USER' | 'ADMIN'
}) {
  ;(getServerSession as jest.Mock).mockResolvedValue({
    user: {
      id: user.id,
      name: user.name || 'Test User',
      email: user.email || 'test@example.com',
      role: user.role,
    },
  })
}

/**
 * Mock authenticated admin session for testing
 */
export function mockAdminSession() {
  mockAuthSession({
    id: 'admin-user-id',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'ADMIN',
  })
}

/**
 * Mock authenticated regular user session for testing
 */
export function mockUserSession() {
  mockAuthSession({
    id: 'test-user-id',
    name: 'Test User',
    email: 'user@example.com',
    role: 'USER',
  })
}

/**
 * Clear all mocks between tests
 */
export function clearMocks() {
  jest.resetAllMocks()
}
