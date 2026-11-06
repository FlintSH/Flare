import { GET, POST } from '@/app/api/profile/upload-token/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/http/access', () => ({
  requireAccount: async () => ({ id: 'owner' }),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } },
}))

const url = 'https://flare.example/api/profile/upload-token'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.findUnique.mockResolvedValue({ uploadToken: 'current-token' })
  mocks.update.mockImplementation(async ({ data }) => data)
})

describe('legacy upload token route', () => {
  it('keeps the credential out of caches when reading it', async () => {
    const response = await GET(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ uploadToken: 'current-token' })
  })

  it('keeps a replaced credential out of caches too', async () => {
    const response = await POST(
      new Request(url, {
        method: 'POST',
        headers: { 'x-real-ip': '2001:db8::71' },
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { uploadToken } = await response.json()
    expect(uploadToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'owner' },
      data: { uploadToken },
      select: { uploadToken: true },
    })
  })

  it('sends the header on refusals as well', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const response = await GET(new Request(url))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
