import { GET } from '@/app/api/files/tags/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/auth/api-auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $queryRaw: mocks.query },
}))

function request(query: string) {
  return new Request(`https://flare.test/api/files/tags?${query}`)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: 'owner' }, response: null })
})

describe('current file tag memberships', () => {
  it.each([401, 403])(
    'stops before querying when authentication returns %s',
    async (status) => {
      mocks.requireAuth.mockResolvedValue({
        user: null,
        response: new Response(null, { status }),
      })
      expect((await GET(request('fileIds=one'))).status).toBe(status)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it.each([
    '',
    'fileIds=',
    'fileIds=one,,two',
    'fileIds=%20',
    'fileIds=one&fileIds=two',
    `fileIds=${'a'.repeat(129)}`,
    `fileIds=${Array.from({ length: 101 }, (_, index) => `f${index}`).join(',')}`,
  ])(
    'rejects malformed or oversized selection %s before querying',
    async (query) => {
      expect((await GET(request(query))).status).toBe(400)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it('deduplicates IDs and returns current memberships in selection order without caching', async () => {
    mocks.query.mockResolvedValue([
      { id: 'two', tags: [] },
      { id: 'one', tags: [{ id: 'tag', name: 'Current tag' }] },
    ])
    const response = await GET(request('fileIds=one,%20two,one'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        files: [
          { id: 'one', tags: [{ id: 'tag', name: 'Current tag' }] },
          { id: 'two', tags: [] },
        ],
      },
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls[0][0].values).toEqual([
      'owner',
      'owner',
      'one',
      'two',
    ])
  })

  it('accepts exactly 100 files in one parameterized query', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `f${index}`)
    mocks.query.mockResolvedValue(ids.map((id) => ({ id, tags: [] })))
    expect((await GET(request(`fileIds=${ids.join(',')}`))).status).toBe(200)
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls[0][0].values).toHaveLength(102)
  })

  it('binds unusual IDs as data rather than SQL text', async () => {
    const id = "' OR true --"
    mocks.query.mockResolvedValue([{ id, tags: [] }])
    expect(
      (await GET(request(`fileIds=${encodeURIComponent(id)}`))).status
    ).toBe(200)
    const sql = mocks.query.mock.calls[0][0]
    expect(sql.values).toContain(id)
    expect(sql.sql).not.toContain(id)
  })

  it('returns a generic error for a partially unavailable selection without leaking owned results', async () => {
    mocks.query.mockResolvedValue([{ id: 'one', tags: [] }])
    const response = await GET(request('fileIds=one,unavailable'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: 'One or more files are no longer available.',
    })
  })
})
