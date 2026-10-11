import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

// These contributor scripts are excluded from the Docker build context. Load
// the CommonJS helper when tests run, without adding it to production type checks.
const { cleanupThumbnailFixtures } = createRequire(import.meta.url)(
  '../../scripts/timeline/thumbnail-cleanup.cjs'
)

const origin = 'http://localhost:3064'
const fixtures = [
  { id: 'one', name: 'public.png' },
  { id: 'two', name: 'private.png' },
  { id: 'three', name: 'protected.png' },
]
const response = (status: number) => ({
  ok: () => status >= 200 && status < 300,
  status: () => status,
})

function harness() {
  const events: string[] = []
  const remove = vi.fn(async (url: string) => {
    events.push(url)
    return response(204)
  })
  const close = vi.fn(async () => {
    events.push('closed')
  })
  const options = {
    browser: { close },
    owner: { context: { request: { delete: remove } } },
    fixtures,
    origin,
  }
  return { options, remove, close, events }
}

describe('thumbnail browser check cleanup', () => {
  it('deletes all uploads before closing the browser on success', async () => {
    const { options, events } = harness()
    await cleanupThumbnailFixtures(options)
    expect(events).toEqual([
      `${origin}/api/files/one`,
      `${origin}/api/files/two`,
      `${origin}/api/files/three`,
      'closed',
    ])
  })

  it('attempts later deletions and closes Chromium after transport and HTTP failures', async () => {
    const { options, remove, close } = harness()
    const transportError = new Error('connection reset')
    remove.mockRejectedValueOnce(transportError)
    remove.mockResolvedValueOnce(response(503))
    const error = await cleanupThumbnailFixtures(options).catch(
      (failure: unknown) => failure
    )
    expect(remove.mock.calls.map(([url]) => url)).toEqual(
      fixtures.map((file) => `${origin}/api/files/${file.id}`)
    )
    expect(close).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(AggregateError)
    const failures = (error as AggregateError).errors
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({
      message: 'Cleanup failed for public.png',
      cause: transportError,
    })
    expect(failures[1]).toMatchObject({
      message: 'Cleanup failed for private.png',
    })
    expect(failures[1].cause.message).toContain('HTTP 503')
  })

  it('preserves an original verification error when login failed before cleanup', async () => {
    const { options, remove, close } = harness()
    const verificationError = new Error('sign-in failed')
    await expect(
      cleanupThumbnailFixtures({
        ...options,
        owner: undefined,
        failures: [verificationError],
      })
    ).rejects.toBe(verificationError)
    expect(remove).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports verification, deletion, and shutdown errors together after every attempt', async () => {
    const { options, remove, close } = harness()
    const verificationError = new Error('preview failed')
    const shutdownError = new Error('browser connection failed')
    remove.mockResolvedValueOnce(response(500))
    close.mockRejectedValueOnce(shutdownError)
    const error = await cleanupThumbnailFixtures({
      ...options,
      failures: [verificationError],
    }).catch((failure: unknown) => failure)
    expect(remove).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(AggregateError)
    const failures = (error as AggregateError).errors
    expect(failures).toHaveLength(3)
    expect(failures[0]).toBe(verificationError)
    expect(failures[1].cause.message).toContain('HTTP 500')
    expect(failures[2]).toMatchObject({
      message: 'Could not close the thumbnail check browser',
      cause: shutdownError,
    })
  })
})
