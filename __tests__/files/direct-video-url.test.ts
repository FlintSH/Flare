import { GET } from '@/app/(raw)/[userUrlId]/[filename]/direct/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  resolve: vi.fn(),
  findUnique: vi.fn(),
  access: vi.fn(),
  publicUrl: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: mocks.findUnique } },
}))
vi.mock('@/lib/files/access', () => ({ checkFileAccess: mocks.access }))
vi.mock('@/lib/files/resolve', () => ({ resolveFileUrlPath: mocks.resolve }))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getPublicUrl: mocks.publicUrl }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue(null)
  mocks.resolve.mockResolvedValue('/owner/preview.webm')
  mocks.findUnique.mockResolvedValue({
    urlPath: '/owner/preview.webm',
    path: 'preview.webm',
    mimeType: 'video/webm',
  })
  mocks.access.mockResolvedValue({ allowed: true })
  mocks.publicUrl.mockResolvedValue(null)
})

describe('direct video playback URL', () => {
  it('preserves special characters in a protected local video password', async () => {
    const password = 'watch+share&safe?<>#100%'
    const query = new URLSearchParams({ password })
    const response = await GET(
      new Request(`https://flare.example/owner/preview.webm/direct?${query}`),
      {
        params: Promise.resolve({
          userUrlId: 'owner',
          filename: 'preview.webm',
        }),
      }
    )
    expect(response.status).toBe(200)
    const playback = new URL(
      (await response.json()).url,
      'https://flare.example'
    )
    expect(playback.pathname).toBe('/owner/preview.webm/raw')
    expect([...playback.searchParams]).toEqual([['password', password]])
    expect(playback.hash).toBe('')
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), null, password)
  })

  it('does not disclose a playback URL when file access is denied', async () => {
    mocks.access.mockResolvedValue({ allowed: false, status: 403 })
    const response = await GET(
      new Request('https://flare.example/owner/preview.webm/direct'),
      {
        params: Promise.resolve({
          userUrlId: 'owner',
          filename: 'preview.webm',
        }),
      }
    )
    expect(response.status).toBe(403)
    expect(mocks.publicUrl).not.toHaveBeenCalled()
  })
})
