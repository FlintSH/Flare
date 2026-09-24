import { DELETE, PATCH } from '@/app/api/saved-views/[id]/route'
import { GET, POST } from '@/app/api/saved-views/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/saved-views/service', async (original) => ({
  ...(await original<typeof import('@/lib/saved-views/service')>()),
  listSavedViews: mocks.list,
  createSavedView: mocks.create,
  updateSavedView: mocks.update,
  deleteSavedView: mocks.remove,
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({ loggers: { files: { error: vi.fn() } } }))

const context = { params: Promise.resolve({ id: 'view-id' }) }
function request(
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return new Request('https://flare.example/api/saved-views', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner', role: 'ADMIN' } })
  mocks.list.mockResolvedValue([])
})

describe('session-only saved view endpoints', () => {
  it('rejects anonymous users and all bearer credentials, even alongside a valid browser session', async () => {
    for (const authorization of [
      undefined,
      'Bearer flr_secret',
      'Bearer legacy-token',
    ]) {
      mocks.session.mockResolvedValue(
        authorization ? { user: { id: 'owner' } } : null
      )
      const headers: Record<string, string> = authorization
        ? { Authorization: authorization }
        : {}
      const responses = await Promise.all([
        GET(request('GET', undefined, headers)),
        POST(request('POST', {}, headers)),
        PATCH(request('PATCH', {}, headers), context),
        DELETE(request('DELETE', {}, headers), context),
      ])
      expect(responses.map((response) => response.status)).toEqual([
        401, 401, 401, 401,
      ])
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('keeps reads private and uses the session account even for administrators', async () => {
    const response = await GET(request())
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [], success: true })
    expect(mocks.list).toHaveBeenCalledWith('owner')
  })

  it.each(['POST', 'PATCH', 'DELETE'])(
    'requires same-origin JSON for %s',
    async (method) => {
      const route =
        method === 'POST'
          ? POST
          : method === 'PATCH'
            ? (req: Request) => PATCH(req, context)
            : (req: Request) => DELETE(req, context)
      expect(
        (
          await route(
            request(method, {}, { Origin: 'https://attacker.example' })
          )
        ).status
      ).toBe(403)
      expect(
        (await route(request(method, {}, { 'Sec-Fetch-Site': 'cross-site' })))
          .status
      ).toBe(403)
      expect(
        (await route(request(method, {}, { 'Content-Type': 'text/plain' })))
          .status
      ).toBe(415)
      expect(
        (
          await route(
            request(method, {}, { 'Content-Type': 'application/json-evil' })
          )
        ).status
      ).toBe(415)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.remove).not.toHaveBeenCalled()
    }
  )

  it('bounds streamed UTF-8 body bytes without trusting Content-Length and rejects malformed JSON', async () => {
    expect(
      (await POST(request('POST', { name: '🍒'.repeat(5000), filters: {} })))
        .status
    ).toBe(413)
    expect(
      (await POST(request('POST', {}, { 'Content-Length': '17000' }))).status
    ).toBe(413)
    expect(
      (
        await POST(
          new Request('https://flare.example/api/saved-views', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
          })
        )
      ).status
    ).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each(['+24:00', '+99:99', '+12:99'])(
    'rejects malformed time zone %s as a client error before persisting',
    async (offset) => {
      const filters = { dateFrom: `2026-09-01T00:00:00${offset}` }
      for (const response of [
        await POST(request('POST', { name: 'Invalid date', filters })),
        await PATCH(request('PATCH', { revision: 1, filters }), context),
      ]) {
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({
          success: false,
          error: 'Choose a valid date and time zone.',
        })
      }
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )

  it('requires deletion revision and exposes conflicts as actionable messages', async () => {
    expect((await DELETE(request('DELETE', {}), context)).status).toBe(400)
    const { SavedViewError } = await import('@/lib/saved-views/service')
    mocks.remove.mockRejectedValue(
      new SavedViewError(
        'Refresh saved views and try again.',
        409,
        'SAVED_VIEW_STALE'
      )
    )
    const response = await DELETE(request('DELETE', { revision: 2 }), context)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Refresh saved views and try again.',
      code: 'SAVED_VIEW_STALE',
      success: false,
    })
    expect(mocks.remove).toHaveBeenCalledWith('owner', 'view-id', 2)
  })
})
