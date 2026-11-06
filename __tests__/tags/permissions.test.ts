import { PATCH as changeFileTags } from '@/app/api/files/tags/route'
import { POST as applyRule } from '@/app/api/tags/[id]/apply/route'
import { DELETE, PATCH } from '@/app/api/tags/[id]/route'
import { GET, POST } from '@/app/api/tags/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessError } from '@/lib/http/errors'

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/http/access', () => ({ requireAccount: mocks.requireAccount }))
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
  mocks.requireAccount.mockResolvedValue({ id: 'owner', role: 'ADMIN' })
})

const context = { params: Promise.resolve({ id: 'tag' }) }
const mutations = [
  ['create', 'POST', (request: Request) => POST(request)],
  ['edit', 'PATCH', (request: Request) => PATCH(request, context)],
  ['delete', 'DELETE', (request: Request) => DELETE(request, context)],
  ['apply rule', 'POST', (request: Request) => applyRule(request, context)],
  ['bulk edit', 'PATCH', (request: Request) => changeFileTags(request)],
] as const

describe('tag API permission boundaries', () => {
  it.each(mutations)(
    'rejects cross-origin %s writes before accessing tags',
    async (_name, method, handler) => {
      const response = await handler(
        new Request('http://flare.test/api/tags', {
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
    async (_name, method, handler) => {
      mocks.requireAccount.mockRejectedValue(new AccessError(401, 'Denied'))
      expect(
        (await handler(new Request('http://flare.test/api/tags', { method })))
          .status
      ).toBe(401)
      expect(mocks.query).not.toHaveBeenCalled()
    }
  )

  it('requires authentication for tag names and counts', async () => {
    mocks.requireAccount.mockRejectedValue(new AccessError(401, 'Denied'))
    expect((await GET(new Request('http://flare.test/api/tags'))).status).toBe(
      401
    )
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it.each(
    mutations.filter(([name]) => ['create', 'edit', 'bulk edit'].includes(name))
  )('rejects text form bodies for %s', async (_name, method, handler) => {
    const response = await handler(
      new Request('http://flare.test/api/tags', {
        method,
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      })
    )
    expect(response.status).toBe(415)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
