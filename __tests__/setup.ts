import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset } from 'jest-mock-extended'

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
  default: jest.fn(),
}))

// Mock nanoid to fix ESM import issues
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-nanoid-value'),
}))

// Improved NextResponse mock for API tests
jest.mock('next/server', () => {
  return {
    NextResponse: {
      json: jest.fn((data, init) => {
        const response = {
          status: init?.status || 200,
          headers: init?.headers || {},
          // Add a json method to mimic the Response interface
          json: async () => data,
          // Add status property to match expectations in tests
          statusCode: init?.status || 200,
        }

        // Define a non-enumerable status property (handled by getter)
        Object.defineProperty(response, 'status', {
          get: function () {
            return this.statusCode
          },
        })

        return response
      }),
      redirect: jest.fn((url) => ({ url })),
    },
  }
})

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
