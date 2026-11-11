import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'

/**
 * The end of a search session (docs/e2ee-spec.md, section 9.8.1). At
 * sign-out the page keeps its keys until it is replaced, and the background
 * work of the library runs for that long. A worker that started again in
 * that time wrote the cache that the sign-out had just deleted.
 */

const workers: { terminated: boolean; messages: unknown[] }[] = []
const removed: string[] = []

class FakeWorker {
  onmessage: unknown = null
  onerror: unknown = null
  readonly record = { terminated: false, messages: [] as unknown[] }
  constructor() {
    workers.push(this.record)
  }
  postMessage(message: unknown) {
    this.record.messages.push(message)
  }
  terminate() {
    this.record.terminated = true
  }
}

const keysOf = (userId: string): StoredAccountKeys => ({
  userId,
  accountPublicKey: new Uint8Array(32),
  accountPrivateKey: new Uint8Array(32),
  oldPrivateKeys: [],
})

async function client() {
  vi.resetModules()
  return import('@/lib/library/search-client')
}

beforeEach(() => {
  workers.length = 0
  removed.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('window', { location: { origin: 'https://flare.example' } })
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => ({
        removeEntry: async (name: string) => {
          removed.push(name)
        },
      }),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the end of a search session', () => {
  it('stops the worker, deletes the cache, and starts no worker again for the same keys', async () => {
    const { searchIndex, endSearchSession } = await client()
    const keys = keysOf('alex')
    searchIndex.start(keys)
    expect(workers).toHaveLength(1)

    await endSearchSession()
    expect(workers[0].terminated).toBe(true)
    expect(removed).toEqual(['flare-e2ee-search'])

    // The index job of the background queue, which still has these keys.
    searchIndex.start(keys)
    expect(workers).toHaveLength(1)
    expect(searchIndex.getState().stopped).toBe(true)
    await expect(searchIndex.sync()).rejects.toThrow('Search is not running')
  })

  it('also when the worker had stopped before the session ended', async () => {
    const { searchIndex, endSearchSession } = await client()
    const keys = keysOf('alex')
    searchIndex.start(keys)
    searchIndex.stop()
    await endSearchSession()
    searchIndex.start(keys)
    expect(workers).toHaveLength(1)
  })

  it('starts a worker for the keys of the next sign-in', async () => {
    const { searchIndex, endSearchSession } = await client()
    searchIndex.start(keysOf('alex'))
    await endSearchSession()
    // The same account again: a new sign-in is a new record of keys.
    searchIndex.start(keysOf('alex'))
    expect(workers).toHaveLength(2)
    expect(workers[1].terminated).toBe(false)
  })

  it('a session that ends before any worker ran blocks nothing', async () => {
    const { searchIndex, endSearchSession } = await client()
    await endSearchSession()
    searchIndex.start(keysOf('alex'))
    expect(workers).toHaveLength(1)
  })
})
