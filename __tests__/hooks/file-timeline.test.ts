import type { FileFilterOptions, FileType } from '@/types/components/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileTimeline } from '@/lib/files/timeline-layout'
import {
  TIMELINE_CACHE_PAGES,
  TIMELINE_PAGE_SIZE,
} from '@/lib/files/timeline-layout'

import { useFileTimeline } from '@/hooks/use-file-timeline'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
}))
// The same dependency-aware hook harness used by the gallery tests. Requests stay
// real promises so out-of-order responses exercise abort and cache ownership.
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (value: unknown) => {
        const next =
          typeof value === 'function' ? value(harness.slots[index]) : value
        if (!Object.is(harness.slots[index], next)) harness.dirty = true
        harness.slots[index] = next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useCallback: (callback: unknown, dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as
      { callback: unknown; dependencies: unknown[] } | undefined
    if (
      !previous ||
      dependencies.some(
        (value, i) => !Object.is(value, previous.dependencies[i])
      )
    ) {
      harness.slots[index] = { callback, dependencies }
      return callback
    }
    return previous.callback
  },
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as
      { dependencies: unknown[]; cleanup?: () => void } | undefined
    if (
      previous &&
      dependencies.every((value, i) =>
        Object.is(value, previous.dependencies[i])
      )
    )
      return
    harness.effects.push(() => {
      previous?.cleanup?.()
      harness.slots[index] = { dependencies, cleanup: effect() }
    })
  },
}))

const filters: FileFilterOptions = {
  search: '',
  types: [],
  visibility: [],
  dateFrom: null,
  dateTo: null,
  sortBy: 'newest',
  groupBy: 'none',
  page: 1,
  limit: 24,
}
const summary: FileTimeline = {
  total: 100_000,
  snapshot: '2026-10-06T12:00:00.000Z',
  groupBy: 'none',
  timezone: 'UTC',
  buckets: [
    {
      key: 'october',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
      count: 100_000,
      offset: 0,
    },
  ],
}
type Props = { filters: FileFilterOptions; refreshKey: number }
const initial: Props = { filters, refreshKey: 0 }
function render(props = initial) {
  let result!: ReturnType<typeof useFileTimeline>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useFileTimeline(props.filters, props.refreshKey)
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result
}
type PendingRequest = {
  url: URL
  signal: AbortSignal
  resolve: (response: Response) => void
}
let requests: PendingRequest[] = []
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
async function flush() {
  // Drain fetch -> JSON -> catch/finally continuations without timing sleeps.
  await new Promise<void>((resolve) => setImmediate(resolve))
}
async function initialize(props = initial, timeline = summary) {
  render(props)
  requests[0].resolve(json({ data: timeline }))
  await flush()
  return render(props)
}
function complete(request: PendingRequest, prefix = '') {
  const page = Number(request.url.searchParams.get('page'))
  const start = (page - 1) * TIMELINE_PAGE_SIZE
  request.resolve(
    json({
      data: Array.from(
        { length: TIMELINE_PAGE_SIZE },
        (_, index) => ({ id: `${prefix}${start + index}` }) as FileType
      ),
    })
  )
}

beforeEach(() => {
  harness.slots = []
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, options: { signal: AbortSignal }) =>
        new Promise<Response>((resolve) => {
          requests.push({
            url: new URL(url, 'http://localhost'),
            signal: options.signal,
            resolve,
          })
        })
    )
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('virtual file library requests', () => {
  it('jumps directly to a deep window, preserving filters, date intersection, and snapshot', async () => {
    const props = {
      filters: {
        ...filters,
        search: 'invoice',
        folder: 'work',
        tag: 'finance',
        dateFrom: '2026-10-05T08:00:00.000Z',
        dateTo: '2026-10-10T09:00:00.000Z',
      },
      refreshKey: 0,
    }
    const hook = await initialize(props)
    hook.ensureRange([48_005, 48_006, 48_007])
    expect(requests).toHaveLength(2)
    const params = requests[1].url.searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      page: '1001',
      limit: '48',
      snapshot: summary.snapshot,
      search: 'invoice',
      folder: 'work',
      tag: 'finance',
      dateFrom: props.filters.dateFrom,
      dateTo: props.filters.dateTo,
    })
    expect(requests[0].url.searchParams.get('timezone')).toBeTruthy()
    complete(requests[1])
    await flush()
    expect(render(props).getFile(48_005)?.id).toBe('48005')
  })

  it('uses an exclusive bucket end minus one millisecond for the inclusive file API', async () => {
    const hook = await initialize()
    hook.ensureRange([0])
    expect(requests[1].url.searchParams.get('dateTo')).toBe(
      '2026-10-31T23:59:59.999Z'
    )
  })

  it('caps parallel work at four requests and aborts abandoned windows while scrubbing', async () => {
    let hook = await initialize()
    hook.ensureRange([0, 48, 96, 144, 192, 240])
    expect(requests).toHaveLength(5)
    complete(requests[1])
    await flush()
    hook = render()
    hook.ensureRange([0, 48, 96, 144, 192, 240])
    expect(requests).toHaveLength(6)
    hook.ensureRange([96_000])
    expect(
      requests.slice(2, 6).every((request) => request.signal.aborted)
    ).toBe(true)
    expect(requests).toHaveLength(7)
    complete(requests[3], 'stale-')
    complete(requests[6])
    await flush()
    hook = render()
    expect(hook.getFile(96)).toBeUndefined()
    expect(hook.getFile(96_000)?.id).toBe('96000')
  })

  it('reuses cached pages and evicts old windows after the bounded cache fills', async () => {
    let hook = await initialize()
    for (let page = 0; page <= TIMELINE_CACHE_PAGES; page++) {
      hook.ensureRange([page * 48])
      complete(requests.at(-1)!)
      await flush()
      hook = render()
    }
    expect(hook.getFile(0)).toBeUndefined()
    expect(hook.getFile(48)?.id).toBe('48')
    const previous = requests.length
    hook.ensureRange([48])
    expect(requests).toHaveLength(previous)
  })

  it('does not accept a stale timeline or metadata response after a filter change', async () => {
    let hook = await initialize()
    hook.ensureRange([0])
    const props = { ...initial, filters: { ...filters, search: 'other' } }
    hook = render(props)
    expect(requests[1].signal.aborted).toBe(true)
    expect(hook.timeline).toBeNull()
    complete(requests[1], 'stale-')
    requests[2].resolve(
      json({
        data: {
          ...summary,
          total: 80,
          buckets: [{ ...summary.buckets[0], count: 80 }],
        },
      })
    )
    await flush()
    hook = render(props)
    expect(hook.timeline?.total).toBe(80)
    expect(hook.getFile(0)).toBeUndefined()
    render({ ...props, refreshKey: 1 })
    render({ ...props, refreshKey: 2 })
    expect(requests[3].signal.aborted).toBe(true)
    requests[3].resolve(json({ data: summary }))
    await flush()
    expect(render({ ...props, refreshKey: 2 }).timeline).toBeNull()
  })

  it('stops retrying failed windows until requested, and rejects changed window lengths', async () => {
    let hook = await initialize()
    hook.ensureRange([0])
    requests[1].resolve(json({ data: [] }))
    await flush()
    hook = render()
    expect(hook.hasFailed(0)).toBe(true)
    hook.ensureRange([0])
    expect(requests).toHaveLength(2)
    hook.retry()
    hook = render()
    hook.ensureRange([0])
    expect(requests).toHaveLength(3)
    complete(requests[2])
    await flush()
    expect(render().hasFailed(0)).toBe(false)
    expect(render().getFile(0)?.id).toBe('0')
  })

  it('refreshes the viewport when browser history changes only a legacy page number', async () => {
    await initialize()
    const props = { ...initial, filters: { ...filters, page: 9 } }
    const hook = render(props)
    expect(hook.timeline).toBeNull()
    expect(requests).toHaveLength(2)
    expect(requests[1].url.pathname).toBe('/api/files/timeline')
  })

  it('surfaces summary errors and ignores invalid or empty account ranges', async () => {
    render()
    requests[0].resolve(json({ error: 'Offline' }, 503))
    await flush()
    expect(render()).toMatchObject({
      error: true,
      isLoading: false,
      timeline: null,
    })
    const props = { ...initial, refreshKey: 1 }
    render(props)
    requests[1].resolve(json({ data: { ...summary, total: 0, buckets: [] } }))
    await flush()
    render(props).ensureRange([-1, 0, NaN])
    expect(requests).toHaveLength(2)
  })
})
