import { GET } from '@/app/api/health/route'
import { describe, expect, it } from '@jest/globals'

describe('Health API', () => {
  it('should return a 200 OK response', async () => {
    const response = await GET()

    // Just test that we get a response with status 200
    expect(response.status).toBe(200)
  })
})
