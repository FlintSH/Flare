import { POST as moveFiles } from '@/app/api/files/folders/route'
import { DELETE, PATCH } from '@/app/api/folders/[id]/route'
import { GET, POST } from '@/app/api/folders/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/auth/api-auth', () => ({
  getAuthenticatedUser: mocks.authenticate,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { vaultFolder: { findMany: mocks.query }, $transaction: mocks.query },
}))

const sessionUser = {
  id: 'owner',
  permissions: ['administrator'],
  credential: 'session',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticate.mockResolvedValue(sessionUser)
})

const context = { params: Promise.resolve({ id: 'folder' }) }
const mutations = [
  ['create', 'POST', '/api/folders', (request: Request) => POST(request)],
  [
    'edit',
    'PATCH',
    '/api/folders/folder',
    (request: Request) => PATCH(request, context),
  ],
  [
    'delete',
    'DELETE',
    '/api/folders/folder',
    (request: Request) => DELETE(request, context),
  ],
  [
    'move files',
    'POST',
    '/api/files/folders',
    (request: Request) => moveFiles(request),
  ],
] as const

describe('folder API permission boundaries', () => {
  it.each(mutations)(
    'rejects cross-origin %s writes before accessing folders',
    async (_name, method, path, handler) => {
      const response = await handler(
        new Request(`https://flare.test${path}`, {
          method,
          headers: {
            Origin: 'https://foreign.test',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Cross-origin requests are not allowed.',
      })
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it.each(mutations)(
    'requires authentication for %s',
    async (_name, method, path, handler) => {
      mocks.authenticate.mockResolvedValue(null)
      expect(
        (await handler(new Request(`https://flare.test${path}`, { method })))
          .status
      ).toBe(401)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it.each(mutations.filter(([name]) => name !== 'delete'))(
    'requires JSON for %s',
    async (_name, method, path, handler) => {
      const response = await handler(
        new Request(`https://flare.test${path}`, {
          method,
          headers: { 'Content-Type': 'text/plain' },
          body: '{}',
        })
      )
      expect(response.status).toBe(415)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it('leaves token requests without a browser origin check', async () => {
    mocks.authenticate.mockResolvedValue({
      ...sessionUser,
      credential: 'token',
    })
    const response = await POST(
      new Request('https://flare.test/api/folders', {
        method: 'POST',
        headers: {
          Origin: 'https://foreign.test',
          'Content-Type': 'application/json',
        },
        body: '{',
      })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Invalid JSON.',
    })
  })

  it('requires authentication for folder names, counts, and sharing tokens', async () => {
    mocks.authenticate.mockResolvedValue(null)
    expect(
      (await GET(new Request('https://flare.test/api/folders'))).status
    ).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('lists only the authenticated owner and prevents response caching', async () => {
    mocks.query.mockResolvedValue([])
    const response = await GET(new Request('https://flare.test/api/folders'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'owner' } })
    )
  })
})
