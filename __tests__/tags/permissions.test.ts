import { PATCH as changeFileTags } from '@/app/api/files/tags/route'
import { POST as applyRule } from '@/app/api/tags/[id]/apply/route'
import { DELETE, PATCH } from '@/app/api/tags/[id]/route'
import { GET, POST } from '@/app/api/tags/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/auth/api-auth', () => ({
  getAuthenticatedUser: mocks.authenticate,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    vaultTag: {
      findMany: mocks.query,
      create: mocks.query,
      update: mocks.query,
    },
    $transaction: mocks.query,
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticate.mockResolvedValue({
    id: 'owner',
    permissions: ['administrator'],
    credential: 'session',
  })
})

const context = { params: Promise.resolve({ id: 'tag' }) }
const mutations = [
  ['create', 'POST', '/api/tags', (request: Request) => POST(request)],
  [
    'edit',
    'PATCH',
    '/api/tags/tag',
    (request: Request) => PATCH(request, context),
  ],
  [
    'delete',
    'DELETE',
    '/api/tags/tag',
    (request: Request) => DELETE(request, context),
  ],
  [
    'apply rule',
    'POST',
    '/api/tags/tag/apply',
    (request: Request) => applyRule(request, context),
  ],
  [
    'bulk edit',
    'PATCH',
    '/api/files/tags',
    (request: Request) => changeFileTags(request),
  ],
] as const

describe('tag API permission boundaries', () => {
  it.each(mutations)(
    'rejects cross-origin %s writes before accessing tags',
    async (_name, method, path, handler) => {
      const response = await handler(
        new Request(`http://flare.test${path}`, {
          method,
          headers: {
            Origin: 'https://untrusted.test',
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
    async (_name, method, path, handler) => {
      mocks.authenticate.mockResolvedValue(null)
      expect(
        (await handler(new Request(`http://flare.test${path}`, { method })))
          .status
      ).toBe(401)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it('requires authentication for tag names and counts', async () => {
    mocks.authenticate.mockResolvedValue(null)
    expect((await GET(new Request('http://flare.test/api/tags'))).status).toBe(
      401
    )
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it.each(
    mutations.filter(([name]) => ['create', 'edit', 'bulk edit'].includes(name))
  )('rejects text form bodies for %s', async (_name, method, path, handler) => {
    const response = await handler(
      new Request(`http://flare.test${path}`, {
        method,
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      })
    )
    expect(response.status).toBe(415)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
