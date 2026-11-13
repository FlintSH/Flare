import type { Prisma } from '@prisma/client'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  auditRequest,
  auditSettled,
  configureAuditWriter,
  recordAudit,
  setAuditActor,
  setAuditOutcome,
  setAuditTarget,
} from '@/lib/audit'
import { auditContext } from '@/lib/audit/context'
import { oncePerRequest } from '@/lib/runtime/request-scope'

type Row = Prisma.AuditEventCreateManyInput

const events: Row[] = []
const write = vi.fn<(event: Row) => Promise<void>>()
const writeMany = vi.fn<(batch: Row[]) => Promise<void>>()
const FAILED =
  '[audit] Failed to persist an audit event (Error, unknown); check database availability and migrations'

beforeEach(() => {
  events.length = 0
  write.mockReset().mockImplementation(async (event) => {
    events.push(event)
  })
  writeMany.mockReset().mockImplementation(async (batch) => {
    events.push(...batch)
  })
  configureAuditWriter(write, writeMany)
})
afterEach(async () => {
  // No test leaves an event for the next one's writer.
  await auditSettled()
  vi.restoreAllMocks()
})

/** A request under the request audit, as the route kernel runs it. */
function send(
  handle: (request: Request) => Promise<Response> | Response,
  {
    method = 'GET',
    skipSuccess = false,
    route = '/api/test',
  }: { method?: string; skipSuccess?: boolean; route?: string } = {}
) {
  const request = new Request('http://localhost/api/test?secret=never-record', {
    method,
  })
  return auditRequest(request, { route, skipSuccess }, async () =>
    handle(request)
  )
}
const ok = () => new Response('done')

describe('successful reads recorded after the response', () => {
  it.each(['GET', 'HEAD'])(
    'answers a successful %s before its event is written',
    async (method) => {
      const response = await send(ok, { method })
      expect(response.status).toBe(200)
      expect(events).toEqual([])
      expect(write).not.toHaveBeenCalled()

      await auditSettled()
      expect(write).toHaveBeenCalledOnce()
      expect(writeMany).not.toHaveBeenCalled()
      expect(events).toEqual([
        expect.objectContaining({
          action: `http.${method.toLowerCase()}`,
          category: 'requests',
          outcome: 'success',
          status: 200,
          method,
          route: '/api/test',
          requestId: expect.any(String),
          actorName: 'Anonymous',
          details: { durationMs: expect.any(Number) },
        }),
      ])
      expect(JSON.stringify(events)).not.toContain('never-record')
    }
  )

  it('writes reads that finish together with one batch', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        send(() => {
          setAuditTarget({ type: 'file', id: `file-${index}` })
          return ok()
        })
      )
    )
    expect(responses.map((response) => response.status)).toEqual(
      Array(5).fill(200)
    )
    expect(events).toEqual([])
    await auditSettled()
    expect(writeMany).toHaveBeenCalledOnce()
    expect(write).not.toHaveBeenCalled()
    // In the order the requests finished, each under its own request ID.
    expect(events.map((event) => event.targetId)).toEqual([
      'file-0',
      'file-1',
      'file-2',
      'file-3',
      'file-4',
    ])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(5)
  })

  it('writes reads that finish during a write together in the next one', async () => {
    let finishFirst!: () => void
    write.mockImplementationOnce(async (event) => {
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      events.push(event)
    })
    await send(ok)
    // The first write has started and is waiting on the database.
    await nextTurn()
    expect(write).toHaveBeenCalledOnce()
    await Promise.all([send(ok), send(ok), send(ok)])
    await nextTurn()
    expect(writeMany).not.toHaveBeenCalled()

    const settled = auditSettled()
    finishFirst()
    await settled
    expect(write).toHaveBeenCalledOnce()
    expect(writeMany).toHaveBeenCalledOnce()
    expect(writeMany.mock.calls[0][0]).toHaveLength(3)
    expect(events).toHaveLength(4)
  })

  it('writes a burst in bounded batches', async () => {
    await Promise.all(Array.from({ length: 501 }, () => send(ok)))
    await auditSettled()
    expect(writeMany.mock.calls.map(([batch]) => batch.length)).toEqual([500])
    expect(write).toHaveBeenCalledOnce()
    expect(events).toHaveLength(501)
  })

  it('dates a read by when it was answered, not when its event was written', async () => {
    let release = () => {}
    write.mockImplementationOnce(
      (event) =>
        new Promise((resolve) => {
          release = () => {
            events.push(event)
            resolve()
          }
        })
    )
    await send(ok)
    // The first write has started and is held; the second read queues behind it.
    await nextTurn()
    await send(ok)
    const answered = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 25))
    release()
    await auditSettled()
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event.createdAt).toBeInstanceOf(Date)
      expect((event.createdAt as Date).getTime()).toBeLessThanOrEqual(answered)
    }
  })

  it('goes back to recording a read before it answers once 2,000 events wait', async () => {
    // A database that has stopped answering holds the first queued write.
    let release = () => {}
    write.mockImplementationOnce(
      (event) =>
        new Promise((resolve) => {
          release = () => {
            events.push(event)
            resolve()
          }
        })
    )
    await send(ok)
    await nextTurn()
    for (let read = 0; read < 2_000; read++) await send(ok)
    expect(events).toEqual([])

    // The queue is full, so this read waits for its own event.
    await send(ok, { route: '/api/over-the-limit' })
    expect(events).toEqual([
      expect.objectContaining({ route: '/api/over-the-limit' }),
    ])

    release()
    await auditSettled()
    expect(events).toHaveLength(2_002)
  })

  it('settles at once when nothing is queued, and again after every later read', async () => {
    await auditSettled()
    expect(events).toEqual([])
    await send(ok)
    await auditSettled()
    await send(ok)
    await auditSettled()
    await auditSettled()
    expect(events).toHaveLength(2)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('still writes what the handler itself records before answering', async () => {
    const response = await send(async () => {
      await recordAudit({ action: 'file.download', category: 'files' })
      return ok()
    })
    expect(response.status).toBe(200)
    expect(events.map((event) => event.action)).toEqual(['file.download'])
    await auditSettled()
    expect(events.map((event) => event.action)).toEqual([
      'file.download',
      'http.get',
    ])
    expect(events[1].requestId).toBe(events[0].requestId)
  })

  it('shares the queue with every copy of the module in the process', async () => {
    // Route bundles can each load their own copy.
    vi.resetModules()
    const copy = await import('@/lib/audit')
    expect(copy.auditRequest).not.toBe(auditRequest)
    await copy.auditRequest(
      new Request('http://localhost/api/copy'),
      { route: '/api/copy' },
      async () => ok()
    )
    expect(events).toEqual([])
    await auditSettled()
    expect(events).toEqual([expect.objectContaining({ route: '/api/copy' })])
  })
})

describe('what is still recorded before the response', () => {
  beforeEach(() => {
    // A database that takes a while: only an awaited write is there in time.
    write.mockImplementation(async (event) => {
      await nextTurn()
      events.push(event)
    })
  })

  it.each([
    ['a change', 'POST', 201, 'success'],
    ['a change', 'PUT', 200, 'success'],
    ['a change', 'PATCH', 200, 'success'],
    ['a deletion', 'DELETE', 204, 'success'],
    ['a signed-out read', 'GET', 401, 'denied'],
    ['a read without permission', 'GET', 403, 'denied'],
    ['a refused check for a file', 'HEAD', 403, 'denied'],
    ['a read of something missing', 'GET', 404, 'failure'],
    ['a read with a bad query', 'GET', 400, 'failure'],
    ['a read that failed', 'GET', 500, 'failure'],
  ])(
    'writes %s (%s answering %i) first',
    async (_case, method, status, outcome) => {
      const response = await send(() => new Response(null, { status }), {
        method,
      })
      expect(response.status).toBe(status)
      expect(events).toEqual([
        expect.objectContaining({
          action: `http.${method.toLowerCase()}`,
          outcome,
          status,
        }),
      ])
      // Nothing was left for later.
      await auditSettled()
      expect(events).toHaveLength(1)
    }
  )

  it('writes a read masked as missing, which is a refusal, first', async () => {
    const response = await send(() => {
      setAuditOutcome('denied')
      return new Response(null, { status: 404 })
    })
    expect(response.status).toBe(404)
    expect(events).toEqual([
      expect.objectContaining({ outcome: 'denied', status: 404 }),
    ])
  })

  it('writes a read the handler marked as failed first, whatever it answered', async () => {
    await send(() => {
      setAuditOutcome('failure')
      return ok()
    })
    expect(events).toEqual([
      expect.objectContaining({ outcome: 'failure', status: 200 }),
    ])
  })

  it.each(['GET', 'POST'])(
    'writes a %s whose handler threw before passing the error on',
    async (method) => {
      await expect(
        send(
          () => {
            throw new Error('private stack')
          },
          { method }
        )
      ).rejects.toThrow('private stack')
      expect(events).toEqual([
        expect.objectContaining({
          outcome: 'failure',
          status: 500,
          details: {
            durationMs: expect.any(Number),
            reason: 'Unhandled request error',
          },
        }),
      ])
      expect(JSON.stringify(events)).not.toContain('private stack')
      await auditSettled()
      expect(events).toHaveLength(1)
    }
  )
})

describe('reads that are not recorded', () => {
  it('skips a successful read of a quiet route, and still records its refusals', async () => {
    const response = await send(ok, { skipSuccess: true })
    expect(response.status).toBe(200)
    await auditSettled()
    expect(events).toEqual([])
    expect(write).not.toHaveBeenCalled()

    await send(() => new Response(null, { status: 403 }), { skipSuccess: true })
    expect(events).toEqual([
      expect.objectContaining({ outcome: 'denied', status: 403 }),
    ])
  })
})

describe('a log that cannot be written', () => {
  it('reports each failed write once and rejects nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    write.mockRejectedValueOnce(
      Object.assign(new Error('secret database URL'), { code: 'P1001' })
    )
    const response = await send(ok)
    expect(await response.text()).toBe('done')
    expect(error).not.toHaveBeenCalled()
    await expect(auditSettled()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledExactlyOnceWith(
      '[audit] Failed to persist an audit event (Error, P1001); check database availability and migrations'
    )

    // The queue carries on: the next read is written.
    await send(ok)
    await auditSettled()
    expect(events).toHaveLength(1)
    expect(error).toHaveBeenCalledOnce()
  })

  it('reports a failed batch once, and keeps writing the reads that follow', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeMany.mockRejectedValueOnce(new Error('secret database URL'))
    await Promise.all([send(ok), send(ok), send(ok)])
    await expect(auditSettled()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledExactlyOnceWith(FAILED)
    expect(events).toEqual([])

    await Promise.all([send(ok), send(ok)])
    await auditSettled()
    expect(events).toHaveLength(2)
    expect(error).toHaveBeenCalledOnce()
  })

  it('reports every event a single-event writer fails to write', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const single = vi
      .fn<(event: Row) => Promise<void>>()
      .mockRejectedValue(new Error('secret database URL'))
    configureAuditWriter(single)
    await Promise.all([send(ok), send(ok)])
    await expect(auditSettled()).resolves.toBeUndefined()
    expect(single).toHaveBeenCalledTimes(2)
    expect(error.mock.calls).toEqual([[FAILED], [FAILED]])
  })

  it('reports details it cannot record instead of failing the operation', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // An invalid date has no JSON form, so building its row throws.
    const unrecordable = { expiresAt: new Date(Number.NaN) }
    await expect(
      recordAudit({
        action: 'file.update',
        category: 'files',
        details: unrecordable,
      })
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledExactlyOnceWith(
      '[audit] Failed to persist an audit event (RangeError, unknown); check database availability and migrations'
    )
    expect(events).toEqual([])
  })

  it('reports a read queued with no writer configured', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    configureAuditWriter(undefined as never)
    const response = await send(ok)
    expect(response.status).toBe(200)
    await expect(auditSettled()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledExactlyOnceWith(FAILED)
  })
})

describe('whose event a queued read is', () => {
  it('keeps its own actor, token and target when another request names others before the write', async () => {
    let contextAtWrite: unknown = 'not written'
    write.mockImplementation(async (event) => {
      contextAtWrite = auditContext.getStore()
      events.push(event)
    })
    const read = await send(
      () => {
        setAuditActor({ id: 'alex', name: 'Alex', tokenId: 'token-a' })
        setAuditTarget({ type: 'file', id: 'file-a', name: 'a.pdf' })
        return ok()
      },
      { route: '/api/files/[id]' }
    )
    expect(read.status).toBe(200)
    expect(events).toEqual([])
    // Before the read's event is written, another account changes another
    // file, and that request is written at once.
    await send(
      () => {
        setAuditActor({ id: 'morgan', name: 'Morgan' })
        setAuditTarget({ type: 'folder', id: 'folder-b', name: 'B' })
        return new Response(null, { status: 201 })
      },
      { method: 'POST', route: '/api/folders' }
    )
    expect(events).toEqual([
      expect.objectContaining({ actorId: 'morgan', targetId: 'folder-b' }),
    ])
    expect(contextAtWrite).toMatchObject({ actorId: 'morgan' })

    await auditSettled()
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      action: 'http.get',
      route: '/api/files/[id]',
      actorId: 'alex',
      actorName: 'Alex',
      targetType: 'file',
      targetId: 'file-a',
      targetName: 'a.pdf',
      details: { tokenId: 'token-a' },
    })
    expect(events[0].details).not.toHaveProperty('tokenId')
    expect(events[1].requestId).not.toBe(events[0].requestId)
    // The write itself belongs to no request.
    expect(contextAtWrite).toBeUndefined()
  })

  it('keeps reads that share a batch apart', async () => {
    await Promise.all(
      ['alex', 'morgan', null].map((name) =>
        send(async () => {
          if (name) setAuditActor({ id: name, name, tokenId: `${name}-token` })
          // Each handler is still running while the others name their actors.
          await nextTurn()
          return ok()
        })
      )
    )
    await auditSettled()
    expect(writeMany).toHaveBeenCalledOnce()
    expect(
      events.map((event) => [
        event.actorId,
        event.actorName,
        (event.details as { tokenId?: string }).tokenId,
      ])
    ).toEqual([
      ['alex', 'alex', 'alex-token'],
      ['morgan', 'morgan', 'morgan-token'],
      [undefined, 'Anonymous', undefined],
    ])
  })
})

describe('one request for each audited handler', () => {
  it('loads a value once for a handler, and again for the next request', async () => {
    const load = vi.fn(() => ({}))
    const handle = async () => {
      const first = oncePerRequest('account', load)
      await nextTurn()
      expect(oncePerRequest('account', load)).toBe(first)
      return ok()
    }
    await send(handle)
    expect(load).toHaveBeenCalledOnce()
    await Promise.all([send(handle), send(handle, { method: 'POST' })])
    expect(load).toHaveBeenCalledTimes(3)
  })
})
