import { GET } from '@/app/api/files/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  transaction: vi.fn(),
  file: { count: vi.fn(), findMany: vi.fn() },
  transactionFile: { findFirst: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  expiration: vi.fn(),
}))

vi.mock('@/lib/auth/api-auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: mocks.file, $transaction: mocks.transaction },
}))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: vi.fn() } } }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))
vi.mock('@/lib/events/handlers/file-expiry', () => ({
  getFileExpirationInfo: mocks.expiration,
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

const anchor = {
  id: 'current-image',
  name: 'holiday.jpg',
  size: 2048,
  views: 5,
  downloads: 2,
  uploadedAt: new Date('2026-09-16T12:00:00Z'),
}
const imagesWhere = {
  AND: [{ userId: 'owner' }, { mimeType: { startsWith: 'image/' } }],
}

function file(id: string) {
  return {
    ...anchor,
    id,
    urlPath: `/${id}`,
    mimeType: 'image/jpeg',
    visibility: 'PRIVATE',
    password: 'stored-password-hash',
    user: { urlId: 'owner-url' },
  }
}

function request(params: Record<string, string> = {}) {
  return GET(
    new Request(
      `https://flare.example/api/files?${new URLSearchParams({
        galleryAnchor: anchor.id,
        galleryDirection: 'next',
        limit: '10',
        ...params,
      })}`
    )
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: 'owner' } })
  mocks.transaction.mockImplementation(async (callback) =>
    callback({ file: mocks.transactionFile })
  )
  mocks.transactionFile.findFirst.mockResolvedValue(anchor)
  mocks.transactionFile.count
    .mockResolvedValueOnce(50)
    .mockResolvedValueOnce(25)
  mocks.transactionFile.findMany.mockResolvedValue([
    file('neighbor-a'),
    file('neighbor-b'),
  ])
  mocks.expiration.mockResolvedValue(null)
})

describe('anchored image navigation API', () => {
  const sorts = [
    ['newest', 'uploadedAt', 'desc'],
    ['oldest', 'uploadedAt', 'asc'],
    ['largest', 'size', 'desc'],
    ['smallest', 'size', 'asc'],
    ['most-viewed', 'views', 'desc'],
    ['least-viewed', 'views', 'asc'],
    ['most-downloaded', 'downloads', 'desc'],
    ['least-downloaded', 'downloads', 'asc'],
    ['name', 'name', 'asc'],
  ] as const

  it.each(sorts)(
    'finds strict next neighbors for %s, breaking equal %s values by id',
    async (sortBy, field, order) => {
      const response = await request({ sortBy, page: '99' })
      expect(response.status).toBe(200)
      expect(mocks.transactionFile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              imagesWhere,
              {
                OR: [
                  {
                    [field]: { [order === 'asc' ? 'gt' : 'lt']: anchor[field] },
                  },
                  { [field]: anchor[field], id: { gt: anchor.id } },
                ],
              },
            ],
          },
          orderBy: [{ [field]: order }, { id: 'asc' }],
          take: 10,
        })
      )
      expect(
        mocks.transactionFile.findMany.mock.calls[0][0]
      ).not.toHaveProperty('skip')
      expect(mocks.transactionFile.count).toHaveBeenNthCalledWith(2, {
        where: {
          AND: [
            imagesWhere,
            {
              OR: [
                { [field]: { [order === 'asc' ? 'lt' : 'gt']: anchor[field] } },
                { [field]: anchor[field], id: { lt: anchor.id } },
              ],
            },
          ],
        },
      })
      const body = await response.json()
      expect(body.data.map((row: { id: string }) => row.id)).toEqual([
        'neighbor-a',
        'neighbor-b',
      ])
      expect(body.pagination).toEqual({
        total: 50,
        page: 3,
        pageCount: 5,
        limit: 10,
        offset: 26,
      })
    }
  )

  it.each(sorts)(
    'finds nearest previous neighbors for %s and returns forward order',
    async (sortBy, field, order) => {
      const response = await request({ sortBy, galleryDirection: 'previous' })
      expect(response.status).toBe(200)
      expect(mocks.transactionFile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              imagesWhere,
              {
                OR: [
                  {
                    [field]: { [order === 'asc' ? 'lt' : 'gt']: anchor[field] },
                  },
                  { [field]: anchor[field], id: { lt: anchor.id } },
                ],
              },
            ],
          },
          orderBy: [
            { [field]: order === 'asc' ? 'desc' : 'asc' },
            { id: 'desc' },
          ],
        })
      )
      const body = await response.json()
      expect(body.data.map((row: { id: string }) => row.id)).toEqual([
        'neighbor-b',
        'neighbor-a',
      ])
      expect(body.pagination.offset).toBe(23)
    }
  )

  it('uses one repeatable-read snapshot for anchor validation, image counts, and results', async () => {
    await request()
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    })
    expect(mocks.transactionFile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [imagesWhere, { id: anchor.id }] },
      })
    )
    expect(mocks.transactionFile.count).toHaveBeenNthCalledWith(1, {
      where: imagesWhere,
    })
    expect(mocks.file.count).not.toHaveBeenCalled()
    expect(mocks.file.findMany).not.toHaveBeenCalled()
  })

  it('applies owner, image type, and all selected filters when validating the anchor', async () => {
    await request({
      search: 'holiday',
      types: 'image/jpeg,image/png',
      visibility: 'private,hasPassword',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-12-31T23:59:59.999Z',
    })
    const filteredWhere = {
      AND: [
        {
          userId: 'owner',
          AND: [
            {
              OR: [
                { name: { contains: 'holiday', mode: 'insensitive' } },
                { ocrText: { contains: 'holiday', mode: 'insensitive' } },
              ],
            },
            { mimeType: { in: ['image/jpeg', 'image/png'] } },
            {
              uploadedAt: {
                gte: new Date('2026-01-01T00:00:00.000Z'),
                lte: new Date('2026-12-31T23:59:59.999Z'),
              },
            },
            { OR: [{ visibility: 'PRIVATE' }, { password: { not: null } }] },
          ],
        },
        { mimeType: { startsWith: 'image/' } },
      ],
    }
    expect(mocks.transactionFile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [filteredWhere, { id: anchor.id }] },
      })
    )
    expect(mocks.transactionFile.count).toHaveBeenNthCalledWith(1, {
      where: filteredWhere,
    })
    expect(
      mocks.transactionFile.findMany.mock.calls[0][0].where.AND[0]
    ).toEqual(filteredWhere)
  })

  it('returns the same 404 for a missing or ineligible anchor without exposing counts', async () => {
    mocks.transactionFile.findFirst.mockResolvedValue(null)
    const response = await request()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Image not found',
    })
    expect(mocks.transactionFile.count).not.toHaveBeenCalled()
    expect(mocks.transactionFile.findMany).not.toHaveBeenCalled()
  })

  it.each(['next', 'previous'])(
    'returns the current anchor rank at an empty %s boundary',
    async (galleryDirection) => {
      mocks.transactionFile.findMany.mockResolvedValue([])
      const response = await request({ galleryDirection })
      const body = await response.json()
      expect(body.data).toEqual([])
      expect(body.pagination.offset).toBe(25)
    }
  )

  it('preserves public metadata and expiry without returning password hashes', async () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z')
    mocks.expiration.mockResolvedValue(expiresAt)
    const response = await request()
    const body = await response.json()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body.data[0]).toMatchObject({
      id: 'neighbor-a',
      hasPassword: true,
      expiresAt: expiresAt.toISOString(),
    })
    expect(body.data[0]).not.toHaveProperty('password')
  })

  it.each<Record<string, string>>([
    { galleryDirection: 'invalid' },
    { galleryDirection: '' },
    { galleryAnchor: '' },
    { limit: '-1' },
    { limit: '2.5' },
    { limit: 'infinite' },
    { page: '0' },
  ])('rejects malformed navigation parameters %j', async (parameters) => {
    expect((await request(parameters)).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('caps requested neighbor windows at 100 images', async () => {
    const response = await request({ limit: '1000' })
    expect((await response.json()).pagination.limit).toBe(100)
    expect(mocks.transactionFile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    )
  })

  it('requires authentication before accessing an anchor', async () => {
    mocks.requireAuth.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    })
    expect((await request()).status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
