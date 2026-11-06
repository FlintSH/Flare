import { describe, expect, it, vi } from 'vitest'

function request(address: string) {
  return new Request('https://flare.test/api/files', {
    method: 'POST',
    headers: { 'x-real-ip': address },
  })
}

describe('per-process request limits', () => {
  it('spend one budget per limit even from separately bundled module copies', async () => {
    const first = await import('@/lib/security/rate-limit')
    vi.resetModules()
    const second = await import('@/lib/security/rate-limit')
    expect(second).not.toBe(first)
    expect(second.uploadLimiter).toBe(first.uploadLimiter)

    const client = request('198.51.100.70')
    expect(await first.rateLimit(client, first.requestLimit('copies', 2))).toBe(
      null
    )
    expect(
      await second.rateLimit(client, second.requestLimit('copies', 2))
    ).toBe(null)
    expect(
      (await first.rateLimit(client, first.requestLimit('copies', 2)))?.status
    ).toBe(429)
  })

  it('refuse the request after each per-minute budget', async () => {
    const limits = await import('@/lib/security/rate-limit')
    for (const [limiter, budget, address] of [
      [limits.authLimiter, 5, '198.51.100.80'],
      [limits.setupLimiter, 3, '198.51.100.81'],
      [limits.uploadLimiter, 30, '198.51.100.82'],
      [limits.generalLimiter, 60, '198.51.100.83'],
    ] as const) {
      for (let spent = 0; spent < budget; spent++)
        expect(await limits.rateLimit(request(address), limiter)).toBeNull()
      const refused = await limits.rateLimit(request(address), limiter)
      expect(refused?.status).toBe(429)
      expect(refused?.headers.get('Retry-After')).toBe('60')
    }
  })

  it('tell a refused client to wait one whole window', async () => {
    const { rateLimit, requestLimit } =
      await import('@/lib/security/rate-limit')
    const limiter = requestLimit('window', 1, 600)
    expect(await rateLimit(request('198.51.100.71'), limiter)).toBeNull()
    const refused = await rateLimit(request('198.51.100.71'), limiter)
    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('Retry-After')).toBe('600')
    expect(refused?.headers.get('Content-Type')).toBe('application/json')
    expect(await refused?.json()).toEqual({ error: 'Too many requests' })
    expect(await rateLimit(request('198.51.100.72'), limiter)).toBeNull()
  })
})
