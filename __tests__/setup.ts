import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset } from 'jest-mock-extended'

import { asMockFunction } from './helpers/types'

// Add Jest typings
declare global {
  namespace NodeJS {
    interface Global {
      createMockFormData: (data: Record<string, unknown>) => FormData
    }
  }

  // eslint-disable-next-line no-var
  var createMockFormData: (data: Record<string, unknown>) => FormData
}

// Mock PrismaClient for tests
const prisma = mockDeep<PrismaClient>()

// Mock modules
jest.mock('@/lib/database/prisma', () => ({
  prisma,
}))

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('next-auth/next', () => ({
  default: jest.fn(() => {
    return { GET: jest.fn(), POST: jest.fn() }
  }),
}))

// Mock Next.js headers function
jest.mock('next/headers', () => ({
  headers: jest.fn(() => new Map()),
}))

// Mock nanoid to fix ESM import issues
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-nanoid-value'),
}))

// Create a simple mock response object that mimics NextResponse
class MockResponse {
  status: number
  headers: Record<string, string>
  body: any

  constructor(
    body: any,
    options: { status?: number; headers?: Record<string, string> } = {}
  ) {
    this.body = body
    this.status = options.status || 200
    this.headers = options.headers || {}
  }

  // Add a json method to mimic the Response interface
  async json() {
    return this.body
  }
}

// Improved NextResponse mock for API tests
jest.mock('next/server', () => {
  return {
    NextResponse: {
      json: jest.fn((data, init) => {
        return new MockResponse(data, init)
      }),
      redirect: jest.fn((url) => ({ url, status: 302 })),
    },
  }
})

// Mock all API handlers to make them type-safe
jest.mock(
  '@/app/api/health/route',
  () => ({
    GET: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/auth/register/route',
  () => ({
    POST: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/auth/registration-status/route',
  () => ({
    GET: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/setup/route',
  () => ({
    POST: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/setup/check/route',
  () => ({
    GET: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/users/route',
  () => ({
    GET: asMockFunction(jest.fn()),
    POST: asMockFunction(jest.fn()),
    PUT: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/users/[id]/route',
  () => ({
    GET: asMockFunction(jest.fn()),
    DELETE: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/files/route',
  () => ({
    GET: asMockFunction(jest.fn()),
    POST: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

jest.mock(
  '@/app/api/files/[id]/route',
  () => ({
    GET: asMockFunction(jest.fn()),
    PUT: asMockFunction(jest.fn()),
    DELETE: asMockFunction(jest.fn()),
  }),
  { virtual: true }
)

// Reset mocks between tests
beforeEach(() => {
  mockReset(prisma)
})

// Global utilities for testing
global.createMockFormData = (data: Record<string, unknown>) => {
  const formData = new FormData()
  Object.entries(data).forEach(([key, value]) => {
    formData.append(key, value as string)
  })
  return formData
}

export { prisma }
