import { GET } from '@/app/api/files/types/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/http/access', () => ({ requireAccount: mocks.requireAccount }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $queryRaw: mocks.query },
}))

const types = () => GET(new Request('https://flare.test/api/files/types'))
const rows = (...mimeTypes: string[]) =>
  mimeTypes.map((mimeType) => ({ mimeType }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAccount.mockResolvedValue({ id: 'owner' })
  mocks.query.mockResolvedValue([])
})

describe('GET /api/files/types', () => {
  it('lists the types of the requester’s files in order', async () => {
    // The database's own order depends on its collation.
    mocks.query.mockResolvedValue(
      rows('video/mp4', 'application/pdf', 'image/png', 'Image/HEIC', 'audio/x')
    )
    const response = await types()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      success: true,
      data: {
        types: [
          'Image/HEIC',
          'application/pdf',
          'audio/x',
          'image/png',
          'video/mp4',
        ],
      },
    })
  })

  it('asks for the files of the requester alone, in one query', async () => {
    await types()
    expect(mocks.query).toHaveBeenCalledOnce()
    const [sql, ...values] = mocks.query.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ]
    // The first type, and each next one, are both looked up for this account.
    expect(values).toEqual(['owner', 'owner'])
    expect(sql.join('?').match(/"userId" = \?/g)).toHaveLength(2)
  })

  it('answers an empty library with no types', async () => {
    expect(await (await types()).json()).toEqual({
      success: true,
      data: { types: [] },
    })
  })

  it('refuses a request without an account before reading any file', async () => {
    mocks.requireAccount.mockRejectedValue(new AccessError(401, 'Unauthorized'))
    const response = await types()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('answers a failed read with a logged 500 and no database detail', async () => {
    const logged = vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    mocks.query.mockRejectedValue(new Error('private connection secret'))
    const response = await types()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Failed to fetch file types',
    })
    expect(logged).toHaveBeenCalledOnce()
  })
})
