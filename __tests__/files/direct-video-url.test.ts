import { GET } from '@/app/(raw)/[userUrlId]/[filename]/direct/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  findUnique: vi.fn(),
  access: vi.fn(),
  publicUrl: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: { findUnique: mocks.findUnique } },
}))
vi.mock('@/lib/files/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/files/access')>()),
  checkFileAccess: mocks.access,
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getPublicUrl: mocks.publicUrl }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue(null)
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
    expect(mocks.access).toHaveBeenCalledWith(
      expect.anything(),
      null,
      password,
      { requester: null }
    )
  })

  it('encodes a name from an earlier build so the playback URL reaches it', async () => {
    // Earlier builds could keep `#`, `%` or spaces in a URL name; returned
    // as typed, the URL ended at the `#`.
    mocks.findUnique.mockResolvedValue({
      urlPath: '/owner/clip #2 50%.webm',
      path: 'clip.webm',
      mimeType: 'video/webm',
    })
    const response = await GET(
      new Request(
        'https://flare.example/owner/clip%20%232%2050%25.webm/direct'
      ),
      {
        params: Promise.resolve({
          userUrlId: 'owner',
          filename: 'clip #2 50%.webm',
        }),
      }
    )
    const { url } = await response.json()
    expect(url).toBe('/owner/clip%20%232%2050%25.webm/raw')
    expect(
      decodeURIComponent(new URL(url, 'https://flare.example').pathname)
    ).toBe('/owner/clip #2 50%.webm/raw')
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
