import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emailRoutes } from '@/lib/email/http'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { routes } from '@/lib/http/route'

type Bucket = { count: number; resetsIn: number }
const database = vi.hoisted(() => ({
  buckets: new Map<string, Bucket>(),
  counted: [] as string[],
}))
vi.mock('next-auth', () => ({ getServerSession: async () => null }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    $queryRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      const digest = values.find((value) => typeof value === 'string')!
      database.counted.push(digest)
      return [database.buckets.get(digest) ?? { count: 1, resetsIn: 3600 }]
    },
  },
}))

const digest = (key: string) => createHash('sha256').update(key).digest('hex')
const address = 'person@example.com'

function refuse(key: string, resetsIn: number) {
  database.buckets.set(digest(key), { count: 99, resetsIn })
}

function limitedRequest() {
  const request = new Request('https://flare.example/api/auth/email/resend', {
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.20' },
  })
  return routes(
    '/api/auth/email/resend',
    emailRoutes
  )(async () => {
    await limitEmailRequest(request, DEFAULT_EMAIL_CONFIG, address)
    return { message: 'Verification email queued.' }
  })(request)
}

beforeEach(() => {
  database.buckets.clear()
  database.counted.length = 0
})

describe('email request limits', () => {
  it('tells the client when the per-IP hour resets, not a fixed minute', async () => {
    refuse('email:ip:203.0.113.20', 1800)
    const response = await limitedRequest()
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('1800')
    expect(await response.json()).toEqual({
      error: 'Too many email requests. Please try again later.',
    })
    // A refused request goes no further than the limit that refused it.
    expect(database.counted).toEqual([digest('email:ip:203.0.113.20')])
  })

  it('answers with the reset of whichever limit refused', async () => {
    refuse(`email:address:${address}`, 2400)
    const byAddress = await limitedRequest()
    expect(byAddress.status).toBe(429)
    expect(byAddress.headers.get('Retry-After')).toBe('2400')

    database.buckets.clear()
    refuse(`email:cooldown:${address}`, 45)
    const byCooldown = await limitedRequest()
    expect(byCooldown.status).toBe(429)
    expect(byCooldown.headers.get('Retry-After')).toBe('45')
  })

  it('lets requests within every limit through', async () => {
    const response = await limitedRequest()
    expect(response.status).toBe(200)
    expect(database.counted).toEqual([
      digest('email:ip:203.0.113.20'),
      digest(`email:address:${address}`),
      digest(`email:cooldown:${address}`),
    ])
  })
})
