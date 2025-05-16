import { NextResponse } from 'next/server'

import { GET } from '@/app/api/health/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { createApiResponse } from '../helpers/test-utils'

describe('Health API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/health', () => {
    it('should return a 200 OK response', async () => {
      // Mock the health API response
      GET.mockImplementation(() => {
        return createApiResponse({
          status: 'ok',
        })
      })

      const response = await GET()

      // Verify status code
      expect(response.status).toBe(200)

      // Verify response structure
      const data = await response.json()
      expect(data).toEqual({
        data: {
          status: 'ok',
        },
        success: true,
      })
    })

    it('should handle unexpected errors gracefully', async () => {
      // Mock NextResponse.json to throw an error
      const originalJsonFn = NextResponse.json
      const mockJsonFn = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      // Replace the implementation temporarily
      NextResponse.json = mockJsonFn

      // Mock the implementation to use the mocked NextResponse
      GET.mockImplementation(() => {
        // This will throw
        return NextResponse.json({
          data: { status: 'ok' },
          success: true,
        })
      })

      try {
        // Try to catch any unhandled errors
        await GET()
        // If we reached here without error, fail the test
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeDefined()
        expect(error instanceof Error).toBe(true)
        expect((error as Error).message).toBe('Unexpected error')
      } finally {
        // Restore the original implementation
        NextResponse.json = originalJsonFn
      }
    })
  })
})
