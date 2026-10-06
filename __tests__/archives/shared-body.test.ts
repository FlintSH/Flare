import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { archiveRoute } from '@/lib/archives/http'
import { ArchiveOperation } from '@/lib/archives/operation'
import {
  SHARED_ARCHIVE_BODY_TIMEOUT_MS,
  SHARED_ARCHIVE_PENDING_BODIES,
  sharedArchiveBody,
} from '@/lib/archives/sharing'

vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))

function json(body = '{}', contentType = 'application/json') {
  return new Request('http://localhost/api/files/source/archive/share', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
}

function unfinished(form = false) {
  const controller = new AbortController()
  const cancelled = vi.fn()
  let entered!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const body = new ReadableStream<Uint8Array>(
    {
      pull(stream) {
        stream.enqueue(
          new TextEncoder().encode(form ? 'path=' : '{"password":')
        )
        entered()
        return new Promise<void>(() => {})
      },
      cancel: cancelled,
    },
    { highWaterMark: 0 }
  )
  const request = new Request(
    'http://localhost/api/files/source/archive/share',
    {
      method: 'POST',
      headers: {
        'Content-Type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      },
      body,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }
  )
  return { request, controller, cancelled, reading }
}

describe('independently bounded shared archive request bodies', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([false, true])(
    'cancels an unfinished body at five seconds (form=%s)',
    async (form) => {
      const input = unfinished(form)
      const outcome = sharedArchiveBody(input.request, form).catch(
        (error) => error
      )
      await input.reading
      await vi.advanceTimersByTimeAsync(SHARED_ARCHIVE_BODY_TIMEOUT_MS - 1)
      expect(input.cancelled).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await outcome).toMatchObject({
        status: 408,
        message:
          'Shared archive request body exceeded the five-second time limit.',
      })
      expect(input.cancelled).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('bounds pending body readers separately while leaving both archive slots available and reuses a cancelled slot', async () => {
    const bodies = Array.from({ length: SHARED_ARCHIVE_PENDING_BODIES }, () =>
      unfinished()
    )
    const pending = bodies.map((input) =>
      sharedArchiveBody(input.request).catch((error) => error)
    )
    try {
      await Promise.all(bodies.map((input) => input.reading))
      const refused = await archiveRoute(() => sharedArchiveBody(json()))
      expect(refused.status).toBe(429)
      expect(refused.headers.get('retry-after')).toBe('5')
      const workers = [
        new ArchiveOperation(
          'owner-capacity-one',
          new AbortController().signal
        ),
        new ArchiveOperation(
          'owner-capacity-two',
          new AbortController().signal
        ),
      ]
      await Promise.all(workers.map((worker) => worker.release()))
      bodies[0].controller.abort()
      expect(await pending[0]).toMatchObject({ status: 408 })
      expect(await sharedArchiveBody(json('{"password":"body-only"}'))).toEqual(
        { password: 'body-only' }
      )
    } finally {
      for (const body of bodies) body.controller.abort()
      await Promise.all(pending)
    }
    expect(bodies.every((body) => body.cancelled.mock.calls.length === 1)).toBe(
      true
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { body: '{}', type: 'text/plain', status: 415 },
    { body: '{', type: 'application/json', status: 400 },
    { body: 'x'.repeat(16385), type: 'application/json', status: 413 },
  ])(
    'releases pending capacity after each rejected body ($status)',
    async ({ body, type, status }) => {
      for (let index = 0; index <= SHARED_ARCHIVE_PENDING_BODIES; index++)
        expect(
          (await archiveRoute(() => sharedArchiveBody(json(body, type)))).status
        ).toBe(status)
      expect(await sharedArchiveBody(json())).toEqual({})
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('rejects an oversized stream without waiting for its cancellation callback', async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => {}))
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new Uint8Array(16385))
      },
      cancel: cancelled,
    })
    const request = new Request(
      'http://localhost/api/files/source/archive/share',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }
    )
    await expect(sharedArchiveBody(request)).rejects.toMatchObject({
      status: 413,
    })
    expect(cancelled).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
