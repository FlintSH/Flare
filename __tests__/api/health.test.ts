import { NextResponse } from 'next/server'

import { GET } from '@/app/api/health/route'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

describe('Health API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/health', () => {
    it('should return a 200 OK response', async () => {
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

      // @ts-ignore - Replace the implementation temporarily
      NextResponse.json = mockJsonFn

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
        // @ts-ignore - Restore
        NextResponse.json = originalJsonFn
      }
    })
  })
})
