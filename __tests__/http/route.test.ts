import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { HttpError, unavailable } from '@/lib/http/errors'
import { parseInput, readForm, readJson } from '@/lib/http/request'
import { type RouteContract, routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  auditRequest: (
    _request: Request,
    _options: unknown,
    handle: () => Promise<Response>
  ) => handle(),
}))

const family: RouteContract = {
  invalid: (error) =>
    new HttpError(400, `Check ${error.issues[0]?.path.join('.') || 'it'}.`),
  failure: { message: 'Family failure.' },
}
const answer = (handle: (request: Request) => Promise<unknown>) =>
  routes('/api/example', family)(handle)(
    new Request('https://flare.test/api/example', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 5 }),
    })
  )

afterEach(() => vi.restoreAllMocks())

describe('the route kernel', () => {
  it('words request input the family way and logs nothing', async () => {
    const logged = vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    const response = await answer((request) =>
      readJson(request, z.object({ name: z.string() }))
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Check name.' })
    expect(logged).not.toHaveBeenCalled()
  })

  it('answers any other failure, a schema failure included, with a logged 500', async () => {
    const logged = vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    for (const thrown of [
      // Data the server stored, not the request: it isn't the client's to fix.
      () => z.object({ saved: z.string() }).parse({}),
      () => {
        throw new TypeError('internal detail')
      },
    ]) {
      const response = await answer(async () => thrown())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Family failure.' })
    }
    expect(logged).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledWith(
      'POST /api/example failed',
      expect.any(TypeError)
    )
  })

  it('sends HttpErrors as they are, logging only what caused a 5xx', async () => {
    const logged = vi.spyOn(loggers.api, 'error').mockImplementation(() => {})
    const conflict = await answer(async () => {
      throw new HttpError(409, 'Taken.', { headers: { 'X-Example': 'yes' } })
    })
    expect(conflict.status).toBe(409)
    expect(conflict.headers.get('X-Example')).toBe('yes')
    expect(await conflict.json()).toEqual({ error: 'Taken.' })
    expect(logged).not.toHaveBeenCalled()

    const outage = new Error('database down')
    const down = await answer(() =>
      Promise.reject(outage).catch(unavailable('Try again later.'))
    )
    expect(down.status).toBe(503)
    expect(await down.json()).toEqual({ error: 'Try again later.' })
    expect(logged).toHaveBeenCalledWith('POST /api/example failed', outage)
  })

  it('parses values that arrive outside a JSON body the same way', async () => {
    const response = await answer(async () =>
      parseInput(z.object({ page: z.coerce.number().int() }), { page: 'x' })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Check page.' })
    const form = await routes(
      '/api/example',
      family
    )((request) => readForm(request, { limit: 1024 }))(
      new Request('https://flare.test/api/example', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: 'not a form',
      })
    )
    expect(form.status).toBe(400)
    expect(await form.json()).toEqual({ error: 'Check it.' })
  })

  it('keeps JSON answers out of caches unless the handler chose', async () => {
    const data = await answer(async () => ({ ok: true }))
    expect(data.headers.get('Cache-Control')).toBe('private, no-store')
    const failed = await answer(async () => {
      throw new HttpError(404, 'Missing.')
    })
    expect(failed.headers.get('Cache-Control')).toBe('private, no-store')
    const chosen = await answer(async () =>
      Response.json({}, { headers: { 'Cache-Control': 'no-store' } })
    )
    expect(chosen.headers.get('Cache-Control')).toBe('no-store')
    const content = await answer(
      async () =>
        new Response('bytes', { headers: { 'Content-Type': 'image/png' } })
    )
    expect(content.headers.get('Cache-Control')).toBeNull()
    // A stored JSON file is file bytes, not an answer.
    const file = await answer(
      async () =>
        new Response('{}', {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'inline; filename="data.json"',
          },
        })
    )
    expect(file.headers.get('Cache-Control')).toBeNull()
  })
})
