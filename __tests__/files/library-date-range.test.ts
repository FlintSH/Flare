import { GET } from '@/app/api/files/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  file: { count: vi.fn(), findMany: vi.fn() },
}))

vi.mock('@/lib/auth/api-auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/database/prisma', () => ({ prisma: { file: mocks.file } }))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: vi.fn() } } }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))
vi.mock('@/lib/events/handlers/file-expiry', () => ({
  getFilesExpirationInfo: async () => new Map(),
}))
vi.mock('@/lib/files/streaming-upload', () => ({
  parseSingleFileUpload: vi.fn(),
}))
vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: vi.fn(),
  uploadLimiter: {},
}))
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }))
vi.mock('@/lib/uploads/finalize', () => ({
  cleanupUncommittedUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  prepareUploadDestination: vi.fn(),
}))
vi.mock('@/lib/uploads/links', () => ({ uploadLinks: vi.fn() }))
vi.mock('@/lib/uploads/options', () => ({}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: 'library-owner' } })
  mocks.file.count.mockResolvedValue(0)
  mocks.file.findMany.mockResolvedValue([])
})

describe('file library date boundaries', () => {
  it('keeps date-only API requests inclusive of the final day', async () => {
    const response = await GET(
      new Request('https://flare.example/api/files?dateTo=2026-09-13')
    )
    const end = new Date('2026-09-13')
    end.setHours(23, 59, 59, 999)
    expect(response.status).toBe(200)
    expect(mocks.file.count).toHaveBeenCalledWith({
      where: { userId: 'library-owner', AND: [{ uploadedAt: { lte: end } }] },
    })
  })
  it.each([
    ['UTC', '2026-09-13T00:00:00.000Z', '2026-09-13T23:59:59.999Z'],
    ['UTC+14', '2026-09-12T10:00:00.000Z', '2026-09-13T09:59:59.999Z'],
    ['UTC-7', '2026-09-13T07:00:00.000Z', '2026-09-14T06:59:59.999Z'],
  ])(
    'preserves the selected local day for a user in %s',
    async (_timezone, start, end) => {
      const query = new URLSearchParams({ dateFrom: start, dateTo: end })
      const response = await GET(
        new Request(`https://flare.example/api/files?${query}`)
      )
      expect(response.status).toBe(200)
      const expectedWhere = {
        userId: 'library-owner',
        AND: [{ uploadedAt: { gte: new Date(start), lte: new Date(end) } }],
      }
      expect(mocks.file.count).toHaveBeenCalledWith({ where: expectedWhere })
      expect(mocks.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere })
      )
    }
  )
})

describe('file library filtering and gallery order', () => {
  it('restricts selected-ID refreshes to the account and other requested filters', async () => {
    const query = new URLSearchParams({
      ids: 'selected-a,selected-b',
      folder: 'unfiled',
      limit: '100',
    })
    const response = await GET(
      new Request(`https://flare.example/api/files?${query}`)
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const where = {
      userId: 'library-owner',
      AND: [{ id: { in: ['selected-a', 'selected-b'] } }, { folderId: null }],
    }
    expect(mocks.file.count).toHaveBeenCalledWith({ where })
    expect(mocks.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, take: 100, skip: 0 })
    )
  })

  it.each([
    '',
    'file-a,',
    ',file-a',
    'file-a,,file-b',
    'file-a,file-a',
    ' file-a',
    'file-a\n',
    'file-a\u0000',
    'x'.repeat(129),
    Array.from({ length: 101 }, (_, index) => `file-${index}`).join(','),
  ])(
    'rejects invalid selected-ID filters before querying files: %j',
    async (ids) => {
      const response = await GET(
        new Request(
          `https://flare.example/api/files?${new URLSearchParams({ ids })}`
        )
      )
      expect(response.status).toBe(400)
      expect(mocks.file.count).not.toHaveBeenCalled()
      expect(mocks.file.findMany).not.toHaveBeenCalled()
    }
  )

  it('rejects repeated ids parameters rather than ignoring a selection', async () => {
    const response = await GET(
      new Request('https://flare.example/api/files?ids=file-a&ids=file-b')
    )
    expect(response.status).toBe(400)
    expect(mocks.file.findMany).not.toHaveBeenCalled()
  })

  it('accepts the full 100-file selection without truncation', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `file-${index}`)
    const response = await GET(
      new Request(
        `https://flare.example/api/files?${new URLSearchParams({ ids: ids.join(','), limit: '100' })}`
      )
    )
    expect(response.status).toBe(200)
    expect(mocks.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'library-owner', AND: [{ id: { in: ids } }] },
        take: 100,
      })
    )
  })

  it('combines MIME type with search, dates, and visibility in a stable page order', async () => {
    const query = new URLSearchParams({
      search: 'holiday',
      types: 'image/jpeg',
      dateFrom: '2026-01-01T00:00:00.000Z',
      visibility: 'private,hasPassword',
      sortBy: 'oldest',
      page: '2',
      limit: '24',
    })
    const response = await GET(
      new Request(`https://flare.example/api/files?${query}`)
    )
    expect(response.status).toBe(200)
    const where = {
      userId: 'library-owner',
      AND: [
        {
          OR: [
            { name: { contains: 'holiday', mode: 'insensitive' } },
            { ocrText: { contains: 'holiday', mode: 'insensitive' } },
          ],
        },
        { mimeType: { in: ['image/jpeg'] } },
        { uploadedAt: { gte: new Date('2026-01-01T00:00:00.000Z') } },
        { OR: [{ visibility: 'PRIVATE' }, { password: { not: null } }] },
      ],
    }
    expect(mocks.file.count).toHaveBeenCalledWith({ where })
    expect(mocks.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        skip: 24,
        take: 24,
      })
    )
  })

  it('uses a stable tie-breaker when sorting by size', async () => {
    await GET(new Request('https://flare.example/api/files?sortBy=largest'))
    expect(mocks.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'library-owner' },
        orderBy: [{ size: 'desc' }, { id: 'asc' }],
      })
    )
  })
})
