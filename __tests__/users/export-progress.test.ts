import { afterEach, describe, expect, it, vi } from 'vitest'

import { exportProgressEvents, trackExport } from '@/lib/users/export-progress'

const OWNER = 'export-owner'

function follow(
  exportId: string,
  { userId = OWNER, signal = new AbortController().signal } = {}
) {
  return exportProgressEvents(userId, exportId, signal)
}

/** The percentages a progress stream sent, once it has ended. */
async function reported(stream: ReadableStream<Uint8Array>) {
  return (await new Response(stream).text())
    .split('\n\n')
    .filter(Boolean)
    .map((event) => JSON.parse(event.replace(/^data: /, '')).progress as number)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('data export progress', () => {
  it('reports the share of files written, then 100 once the download is read', async () => {
    const progress = trackExport(OWNER, 'counted-export-0001', 4)
    const events = reported(follow('counted-export-0001'))

    for (let file = 0; file < 4; file++) progress.entryWritten()
    progress.finished()

    expect(await events).toEqual([0, 25, 50, 75, 99, 100])
  })

  it('sends each percentage once, however many files share it', async () => {
    const progress = trackExport(OWNER, 'many-files-export-01', 1000)
    const events = reported(follow('many-files-export-01'))

    for (let file = 0; file < 25; file++) progress.entryWritten()
    progress.failed()

    expect(await events).toEqual([0, 1, 2])
  })

  it('forgets an export once it settles, so its id never reports a leftover 100', async () => {
    const progress = trackExport(OWNER, 'finished-export-0001', 1)
    progress.entryWritten()
    progress.finished()

    expect(await reported(follow('finished-export-0001'))).toEqual([])
  })

  it('keeps two exports by one account apart', async () => {
    const first = trackExport(OWNER, 'first-tab-export-001', 2)
    const second = trackExport(OWNER, 'second-tab-export-01', 2)
    const firstEvents = reported(follow('first-tab-export-001'))
    const secondEvents = reported(follow('second-tab-export-01'))

    first.entryWritten()
    first.entryWritten()
    first.finished()
    second.entryWritten()
    second.failed()

    expect(await firstEvents).toEqual([0, 50, 99, 100])
    expect(await secondEvents).toEqual([0, 50])
  })

  it('never reports an export to another account', async () => {
    const progress = trackExport(OWNER, 'private-export-0001', 1)

    expect(
      await reported(follow('private-export-0001', { userId: 'someone-else' }))
    ).toEqual([])
    progress.failed()
  })

  it('lets an export that reuses a running id keep its own progress', async () => {
    const older = trackExport(OWNER, 'reused-export-id-001', 2)
    const olderEvents = reported(follow('reused-export-id-001'))
    const newer = trackExport(OWNER, 'reused-export-id-001', 4)
    const newerEvents = reported(follow('reused-export-id-001'))

    older.entryWritten()
    older.finished()
    newer.entryWritten()
    // The older export finishing doesn't forget the newer one.
    const lateEvents = reported(follow('reused-export-id-001'))
    newer.failed()

    expect(await olderEvents).toEqual([0, 50, 100])
    expect(await newerEvents).toEqual([0, 25])
    expect(await lateEvents).toEqual([25])
  })

  it('keeps a quiet export at its progress instead of completing it', async () => {
    vi.useFakeTimers()
    const progress = trackExport(OWNER, 'slow-file-export-001', 2)
    const stream = follow('slow-file-export-001')
    progress.entryWritten()

    // One large file can take minutes to read.
    vi.advanceTimersByTime(60_000)
    progress.failed()
    vi.useRealTimers()
    const events = await reported(stream)

    // Repeated while quiet, so proxies keep the stream open.
    expect(events.length).toBeGreaterThan(20)
    expect(new Set(events)).toEqual(new Set([0, 50]))
  })

  it('stops when the client disconnects', async () => {
    vi.useFakeTimers()
    const progress = trackExport(OWNER, 'client-left-export-1', 2)
    const client = new AbortController()
    const stream = follow('client-left-export-1', { signal: client.signal })
    expect(vi.getTimerCount()).toBe(1)

    client.abort()

    expect(vi.getTimerCount()).toBe(0)
    progress.entryWritten()
    progress.finished()
    vi.useRealTimers()
    expect(await reported(stream)).toEqual([0])
  })

  it('stops when its reader cancels', async () => {
    vi.useFakeTimers()
    const progress = trackExport(OWNER, 'cancelled-reader-001', 2)
    const reader = follow('cancelled-reader-001').getReader()
    expect(vi.getTimerCount()).toBe(1)

    await reader.cancel()

    expect(vi.getTimerCount()).toBe(0)
    // Nothing writes to the cancelled stream any more.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow()
    expect(() => {
      progress.entryWritten()
      progress.finished()
    }).not.toThrow()
  })

  it('ends at once for a client that left before it started', async () => {
    const progress = trackExport(OWNER, 'gone-before-start-01', 1)
    const client = new AbortController()
    client.abort()

    expect(
      await reported(follow('gone-before-start-01', { signal: client.signal }))
    ).toEqual([])
    progress.failed()
  })
})
