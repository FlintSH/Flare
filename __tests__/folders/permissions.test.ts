import { POST as moveFiles } from '@/app/api/files/folders/route'
import { DELETE, PATCH } from '@/app/api/folders/[id]/route'
import { GET, POST } from '@/app/api/folders/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/auth/api-auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { vaultFolder: { findMany: mocks.query }, $transaction: mocks.query },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({
    user: { id: 'owner', role: 'ADMIN' },
    response: null,
  })
})

const context = { params: Promise.resolve({ id: 'folder' }) }
const mutations = [
  ['create', 'POST', (request: Request) => POST(request)],
  ['edit', 'PATCH', (request: Request) => PATCH(request, context)],
  ['delete', 'DELETE', (request: Request) => DELETE(request, context)],
  ['move files', 'POST', (request: Request) => moveFiles(request)],
] as const

describe('folder API permission boundaries', () => {
  it.each(mutations)(
    'rejects cross-origin %s writes before accessing folders',
    async (_name, method, handler) => {
      const response = await handler(
        new Request('https://flare.test/api/folders', {
          method,
          headers: {
            Origin: 'https://foreign.test',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      )
      expect(response.status).toBe(403)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it.each(mutations)(
    'requires authentication for %s',
    async (_name, method, handler) => {
      mocks.requireAuth.mockResolvedValue({
        response: new Response(null, { status: 401 }),
      })
      expect(
        (
          await handler(
            new Request('https://flare.test/api/folders', { method })
          )
        ).status
      ).toBe(401)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it.each(mutations.filter(([name]) => name !== 'delete'))(
    'requires JSON for %s',
    async (_name, method, handler) => {
      const response = await handler(
        new Request('https://flare.test/api/folders', {
          method,
          headers: { 'Content-Type': 'text/plain' },
          body: '{}',
        })
      )
      expect(response.status).toBe(415)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it('requires authentication for folder names, counts, and sharing tokens', async () => {
    mocks.requireAuth.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    })
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
