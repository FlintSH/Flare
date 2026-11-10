import { describe, expect, it } from 'vitest'

import type { FileSort } from '@/lib/library/contract'
import {
  type ViewQuery,
  indexedFile,
  matchesQuery,
  mergeEntries,
  needsClient,
  queryIndex,
  timelineOf,
} from '@/lib/library/search-core'
import {
  type CachedRecord,
  type SyncApi,
  createMemoryStore,
  createSearchIndex,
} from '@/lib/library/search-index'

const newest: FileSort = { field: 'uploadedAt', direction: 'desc' }
const all: ViewQuery = {
  search: '',
  types: [],
  folder: null,
  tag: null,
  visibility: [],
  dateFrom: null,
  dateTo: null,
  sort: newest,
}

function record(
  id: string,
  seq: number,
  extra: Partial<CachedRecord> = {}
): CachedRecord {
  return {
    id,
    seq,
    uploadedAt: `2026-0${(seq % 9) + 1}-10T12:00:00.000Z`,
    size: seq,
    views: 0,
    downloads: 0,
    visibility: 'PUBLIC',
    hasPassword: false,
    folderId: null,
    tags: [],
    // What the server sends is ciphertext. A test stands in for it with the
    // text that a key would open.
    encryption: { header: id, sealedMetadata: `name of ${id}` },
    sealedOcrText: null,
    ...extra,
  }
}

/** A server in memory with the rules of the sync endpoint. */
function server(initial: CachedRecord[]) {
  const rows = new Map(initial.map((row) => [row.id, row]))
  let seq = Math.max(0, ...initial.map((row) => row.seq))
  const requests: string[] = []
  const state = () => ({
    count: rows.size,
    sum: String([...rows.values()].reduce((sum, row) => sum + row.seq, 0)),
  })
  const api: SyncApi = {
    async changes(since) {
      requests.push(`changes:${since}`)
      const changed = [...rows.values()]
        .filter((row) => row.seq > since)
        .sort((a, b) => a.seq - b.seq)
      return {
        records: changed.slice(0, 2),
        more: changed.length > 2,
        state: state(),
      }
    },
    async index(after) {
      requests.push('index')
      const entries = [...rows.values()]
        .filter((row) => !after || row.id > after)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((row) => [row.id, row.seq] as const)
      return { entries: entries.slice(0, 2), more: entries.length > 2 }
    },
    async byIds(ids) {
      requests.push(`ids:${ids.join(',')}`)
      return { records: ids.flatMap((id) => rows.get(id) ?? []) }
    },
  }
  return {
    api,
    requests,
    rows,
    change(id: string, extra: Partial<CachedRecord> = {}) {
      rows.set(id, { ...(rows.get(id) ?? record(id, 0)), ...extra, seq: ++seq })
    },
    /** A row committed late with a lower number than the client has seen. */
    insertBehind(row: CachedRecord) {
      rows.set(row.id, row)
    },
  }
}

const opener =
  (failing: string[] = []) =>
  async (row: CachedRecord) =>
    failing.includes(row.id)
      ? null
      : {
          name: `${row.encryption!.sealedMetadata}.png`,
          type: 'image/png',
          text: row.sealedOcrText,
        }

describe('matching a view in the browser like the server does (section 9.8.3)', () => {
  const file = indexedFile(
    {
      ...record('a', 1, {
        folderId: 'f1',
        tags: [{ id: 't1' }],
        visibility: 'PRIVATE',
        hasPassword: true,
      }),
    },
    { name: 'Invoice March.PDF', type: 'application/pdf', text: 'Total due 40' }
  )
  const match = (query: Partial<ViewQuery>) =>
    matchesQuery(file, { ...all, ...query })

  it('searches the name and the image text for a substring without regard to case', () => {
    expect(match({ search: 'invoice' })).toBe(true)
    expect(match({ search: 'MARCH.pdf' })).toBe(true)
    expect(match({ search: 'total DUE' })).toBe(true)
    expect(match({ search: 'receipt' })).toBe(false)
    // The name and the text are two columns: a match does not span them.
    expect(match({ search: 'pdftotal' })).toBe(false)
    expect(match({ search: 'pdf\ntotal' })).toBe(false)
    const noText = indexedFile(record('b', 2), {
      name: 'x.png',
      type: 'image/png',
      text: null,
    })
    expect(matchesQuery(noText, { ...all, search: 'x' })).toBe(true)
    expect(matchesQuery(noText, { ...all, search: 'null' })).toBe(false)
  })

  it('applies the type, folder, tag, visibility and date filters', () => {
    expect(match({ types: ['application/pdf', 'image/png'] })).toBe(true)
    expect(match({ types: ['image/png'] })).toBe(false)
    expect(match({ folder: 'f1' })).toBe(true)
    expect(match({ folder: 'f2' })).toBe(false)
    expect(match({ folder: 'unfiled' })).toBe(false)
    expect(match({ tag: 't1' })).toBe(true)
    expect(match({ tag: 't2' })).toBe(false)
    expect(match({ tag: 'untagged' })).toBe(false)
    expect(match({ visibility: ['private'] })).toBe(true)
    expect(match({ visibility: ['public'] })).toBe(false)
    expect(match({ visibility: ['public', 'hasPassword'] })).toBe(true)
    expect(match({ dateFrom: '2026-02-10T12:00:00.000Z' })).toBe(true)
    expect(match({ dateFrom: '2026-02-10T12:00:00.001Z' })).toBe(false)
    expect(match({ dateTo: '2026-02-10T11:59:59.999Z' })).toBe(false)
  })

  it('needs the client only for names and types', () => {
    expect(needsClient(all)).toBe(false)
    expect(needsClient({ ...all, folder: 'f1', tag: 't1' })).toBe(false)
    expect(needsClient({ ...all, search: 'x' })).toBe(true)
    expect(needsClient({ ...all, types: ['image/png'] })).toBe(true)
    expect(
      needsClient({ ...all, sort: { field: 'name', direction: 'asc' } })
    ).toBe(true)
  })
})

describe('one list from the server and the browser', () => {
  const files = [
    indexedFile(
      record('e1', 1, { uploadedAt: '2026-03-05T10:00:00.000Z', size: 5 }),
      {
        name: 'beta.png',
        type: 'image/png',
        text: null,
      }
    ),
    indexedFile(
      record('e2', 2, { uploadedAt: '2026-01-20T10:00:00.000Z', size: 50 }),
      {
        name: 'Alpha 10.png',
        type: 'image/png',
        text: null,
      }
    ),
  ]

  it('interleaves plain and encrypted files in the order of the view', () => {
    const plain = [
      ['p1', '2026-03-01T00:00:00.000Z'],
      ['p2', '2026-03-09T00:00:00Z'],
      ['p3', '2025-12-31T00:00:00.000Z'],
    ] as const
    const merged = mergeEntries(newest, plain, queryIndex(files, all))
    expect(merged.map((entry) => entry.id)).toEqual([
      'p2',
      'e1',
      'p1',
      'e2',
      'p3',
    ])
    expect(merged.map((entry) => entry.encrypted)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ])
    const oldest: FileSort = { field: 'uploadedAt', direction: 'asc' }
    expect(
      mergeEntries(
        oldest,
        plain,
        queryIndex(files, { ...all, sort: oldest })
      ).map((entry) => entry.id)
    ).toEqual(['p3', 'e2', 'p1', 'e1', 'p2'])
  })

  it('orders by name and by size across both, with the ID as the last word', () => {
    const byName: FileSort = { field: 'name', direction: 'asc' }
    const names = mergeEntries(
      byName,
      [
        ['p1', 'alpha 2.png'],
        ['p2', 'Zeta.png'],
        ['p3', 'beta.png'],
      ],
      queryIndex(files, { ...all, sort: byName })
    )
    // Without regard to case, numbers by value, equal names by ID.
    expect(names.map((entry) => entry.id)).toEqual([
      'p1',
      'e2',
      'e1',
      'p3',
      'p2',
    ])
    const bySize: FileSort = { field: 'size', direction: 'desc' }
    expect(
      mergeEntries(
        bySize,
        [
          ['p1', 20],
          ['p2', 5],
        ],
        queryIndex(files, { ...all, sort: bySize })
      ).map((entry) => entry.id)
    ).toEqual(['e2', 'p1', 'e1', 'p2'])
  })

  it('groups an order by date into spans with correct offsets, and one span otherwise', () => {
    const plain = [
      ['p1', '2026-03-01T12:00:00.000Z'],
      ['p2', '2026-03-09T12:00:00.000Z'],
      ['p3', '2026-01-02T12:00:00.000Z'],
    ] as const
    const merged = mergeEntries(newest, plain, queryIndex(files, all))
    const timeline = timelineOf(merged, newest, 'month', 'now', 'UTC')
    expect(timeline.total).toBe(5)
    expect(
      timeline.buckets.map((bucket) => [bucket.count, bucket.offset])
    ).toEqual([
      [3, 0],
      [2, 3],
    ])
    for (const bucket of timeline.buckets) {
      expect(Date.parse(bucket.to!)).toBeGreaterThan(Date.parse(bucket.from!))
      expect(bucket.key).toBe(bucket.from)
    }
    // No grouping still has spans by month, for the date rail.
    expect(timelineOf(merged, newest, 'none', 'now', 'UTC')).toMatchObject({
      groupBy: 'none',
      buckets: [{ count: 3 }, { count: 2 }],
    })
    expect(
      timelineOf(merged, newest, 'year', 'now', 'UTC').buckets
    ).toHaveLength(1)
    const week = timelineOf(merged, newest, 'week', 'now', 'UTC')
    expect(week.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(5)
    // A week starts on Monday in the local calendar.
    for (const bucket of week.buckets)
      expect(new Date(bucket.from!).getDay()).toBe(1)
    const bySize: FileSort = { field: 'size', direction: 'asc' }
    expect(timelineOf(merged, bySize, 'month', 'now', 'UTC')).toMatchObject({
      groupBy: 'none',
      buckets: [{ key: 'all', count: 5, offset: 0, from: null }],
    })
    expect(timelineOf([], newest, 'none', 'now', 'UTC').buckets).toEqual([])
  })
})

describe('the local cache of encrypted records (section 9.8.1)', () => {
  it('fills the cache in steps, keeps only what the server sent, and finds files by name and text', async () => {
    const remote = server([
      record('a', 1),
      record('b', 2, { sealedOcrText: 'TOTAL DUE' }),
      record('c', 3),
    ])
    const store = createMemoryStore()
    const progress: string[] = []
    const index = createSearchIndex({
      store,
      api: remote.api,
      open: opener(),
      onProgress: (state) => progress.push(state.status),
    })
    await index.load()
    await index.sync()
    expect(remote.requests).toEqual(['changes:0', 'changes:2'])
    expect(index.state()).toMatchObject({
      status: 'ready',
      indexed: 3,
      total: 3,
    })
    expect(progress.at(-1)).toBe('ready')
    expect(
      index.query({ ...all, search: 'name of b' }).map((entry) => entry.id)
    ).toEqual(['b'])
    expect(
      index.query({ ...all, search: 'total due' }).map((entry) => entry.id)
    ).toEqual(['b'])
    expect(index.types()).toEqual(['image/png'])
    expect(index.rows(['c', 'missing']).map((row) => row.id)).toEqual(['c'])
    // The store has the records as they came: no opened name anywhere.
    expect(JSON.stringify([...store.records.values()])).not.toContain('.png')
    expect([...store.records.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('opens a stored cache without the server, then asks only for what changed', async () => {
    const remote = server([record('a', 1), record('b', 2)])
    const store = createMemoryStore([record('a', 1), record('b', 2)])
    const index = createSearchIndex({ store, api: remote.api, open: opener() })
    await index.load()
    expect(remote.requests).toEqual([])
    expect(index.query(all)).toHaveLength(2)
    remote.change('b', { sealedOcrText: 'new words' })
    remote.change('c')
    await index.sync()
    expect(remote.requests).toEqual(['changes:2'])
    expect(
      index.query({ ...all, search: 'new words' }).map((entry) => entry.id)
    ).toEqual(['b'])
    expect(store.records.get('b')!.seq).toBe(3)
    expect(index.state().total).toBe(3)
  })

  it('repairs itself after a file is deleted elsewhere or a change arrives out of order', async () => {
    const remote = server([record('a', 1), record('b', 2), record('c', 5)])
    const store = createMemoryStore()
    const index = createSearchIndex({ store, api: remote.api, open: opener() })
    await index.load()
    await index.sync()
    remote.requests.length = 0
    // Deleted on another device, and a row committed late below the cursor.
    remote.rows.delete('a')
    remote.insertBehind(record('d', 4))
    await index.sync()
    expect(remote.requests).toEqual(['changes:5', 'index', 'index', 'ids:d'])
    expect(
      index
        .query(all)
        .map((entry) => entry.id)
        .sort()
    ).toEqual(['b', 'c', 'd'])
    expect([...store.records.keys()].sort()).toEqual(['b', 'c', 'd'])
    // In step again: the next update asks for nothing more.
    remote.requests.length = 0
    await index.sync()
    expect(remote.requests).toEqual(['changes:5'])
  })

  it('keeps a record that no key opens out of the results but in the cache', async () => {
    const remote = server([record('a', 1), record('b', 2)])
    const store = createMemoryStore()
    const index = createSearchIndex({
      store,
      api: remote.api,
      open: opener(['b']),
    })
    await index.load()
    await index.sync()
    expect(index.query(all).map((entry) => entry.id)).toEqual(['a'])
    // It still counts, so the cache does not repair forever.
    expect(remote.requests).toEqual(['changes:0'])
    expect(index.state()).toMatchObject({ indexed: 1, total: 2 })
  })

  it('drops a deleted file at once, and erases everything at the end of a session', async () => {
    const remote = server([record('a', 1), record('b', 2)])
    const store = createMemoryStore()
    const index = createSearchIndex({ store, api: remote.api, open: opener() })
    await index.load()
    await index.sync()
    await index.drop(['a'])
    expect(index.query(all).map((entry) => entry.id)).toEqual(['b'])
    expect([...store.records.keys()]).toEqual(['b'])
    await index.clear()
    expect(index.query(all)).toEqual([])
    expect(store.records.size).toBe(0)
  })

  it('works without a persistent store: the same answers from a new session', async () => {
    const remote = server([record('a', 1)])
    for (let session = 0; session < 2; session++) {
      const index = createSearchIndex({
        store: createMemoryStore(),
        api: remote.api,
        open: opener(),
      })
      await index.load()
      await index.sync()
      expect(index.query(all).map((entry) => entry.id)).toEqual(['a'])
    }
    expect(remote.requests).toEqual(['changes:0', 'changes:0'])
  })
})
