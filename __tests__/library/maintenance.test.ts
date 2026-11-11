import { describe, expect, it } from 'vitest'

import { type JobRunner, createMaintenance } from '@/lib/library/maintenance'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function timers() {
  const waiting: { run: () => void; ms: number }[] = []
  return {
    waiting,
    setTimer: (run: () => void, ms: number) => {
      const timer = { run, ms }
      waiting.push(timer)
      return timer
    },
    clearTimer: (timer: unknown) => {
      const index = waiting.indexOf(timer as (typeof waiting)[number])
      if (index !== -1) waiting.splice(index, 1)
    },
  }
}

describe('the background queue of the library', () => {
  it('runs one job at a time, in its order, and one time for many requests', async () => {
    const log: string[] = []
    let finishFolders: () => void = () => undefined
    const job =
      (name: string): JobRunner<string> =>
      async ({ keys }) => {
        log.push(`${name}:${keys}`)
      }
    const queue = createMaintenance<string>({
      tags: job('tags'),
      folders: async () => {
        log.push('folders:start')
        await new Promise<void>((resolve) => (finishFolders = resolve))
        log.push('folders:end')
      },
      pending: job('pending'),
    })
    queue.start('keys', ['pending', 'folders', 'tags'])
    queue.request('pending')
    queue.request('pending')
    await settle()
    expect(log).toEqual(['tags:keys', 'folders:start'])
    expect(queue.getState().running).toBe('folders')
    // Asked for again while it waits: it still runs one time.
    queue.request('tags')
    finishFolders()
    await settle()
    await settle()
    expect(log).toEqual([
      'tags:keys',
      'folders:start',
      'folders:end',
      'tags:keys',
      'pending:keys',
    ])
    expect(queue.getState()).toMatchObject({ running: null, progress: null })
  })

  it('tries a failed job again with a longer wait, then gives up until it is asked for', async () => {
    const clock = timers()
    let runs = 0
    const queue = createMaintenance<string>(
      {
        index: async () => {
          runs++
          throw new Error('offline')
        },
      },
      { ...clock, retryDelaysMs: [10, 20] }
    )
    queue.start('keys', ['index'])
    await settle()
    expect(runs).toBe(1)
    expect(clock.waiting.map((timer) => timer.ms)).toEqual([10])
    clock.waiting.shift()!.run()
    await settle()
    expect(clock.waiting.map((timer) => timer.ms)).toEqual([20])
    clock.waiting.shift()!.run()
    await settle()
    expect(runs).toBe(3)
    // No timer is left: it never loops.
    expect(clock.waiting).toEqual([])
    expect(queue.getState().failed).toEqual(['index'])
    queue.request('index')
    await settle()
    expect(runs).toBe(4)
  })

  it('shows progress, pauses, and stops everything when the keys go', async () => {
    const clock = timers()
    const seen: string[] = []
    let aborted = false
    const queue = createMaintenance<string>(
      {
        pending: async ({ report, unpaused, signal }) => {
          report({ label: 'Finishing new files', done: 1, total: 3 })
          signal.addEventListener('abort', () => (aborted = true))
          await unpaused()
          seen.push('after pause')
          await new Promise(() => undefined)
        },
        index: async () => {
          seen.push('index')
        },
      },
      clock
    )
    queue.start('keys', ['pending'])
    queue.pause()
    await settle()
    // A paused job waits where it asks, and no other job starts.
    expect(queue.getState()).toMatchObject({
      running: 'pending',
      paused: true,
      progress: { label: 'Finishing new files', done: 1, total: 3 },
    })
    expect(seen).toEqual([])
    queue.resume()
    await settle()
    expect(queue.getState()).toMatchObject({
      running: 'pending',
      paused: false,
    })
    expect(seen).toEqual(['after pause'])
    queue.stop()
    expect(aborted).toBe(true)
    expect(queue.getState()).toEqual({
      running: null,
      progress: null,
      paused: false,
      failed: [],
    })
    // A request without keys does nothing.
    queue.request('index')
    await settle()
    expect(seen).toEqual(['after pause'])
  })
})
