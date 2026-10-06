import type { FileType } from '@/types/components/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFreshFileSelection } from '@/hooks/use-fresh-file-selection'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
}))
// Keep concurrent fetches independently controllable while honoring hook effects.
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

const oldFiles = [
  {
    id: 'older',
    name: 'Before.txt',
    size: 10,
    tags: [{ id: 'review', name: 'Review' }],
  },
  { id: 'newer', name: 'Other.txt', size: 20, tags: [] },
] as FileType[]
const freshFiles = [
  { ...oldFiles[1], tags: [{ id: 'review', name: 'Review' }] },
  { ...oldFiles[0], name: 'Renamed.txt', size: 30, tags: [] },
]
type Props = { files: FileType[]; scope: unknown }
const initial: Props = {
  files: oldFiles,
  scope: { folder: 'work', tag: 'review', snapshot: 'old' },
}
function render(props = initial) {
  let result!: ReturnType<typeof useFreshFileSelection>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useFreshFileSelection(props.files, props.scope)
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result
}
type RequestState = {
  url: URL
  signal: AbortSignal
  cache?: string
  resolve: (response: Response) => void
  reject: (reason: Error) => void
}
let requests: RequestState[] = []
function complete(index: number, data: unknown = freshFiles, status = 200) {
  requests[index].resolve(new Response(JSON.stringify({ data }), { status }))
}
beforeEach(() => {
  harness.slots = []
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, options: { signal: AbortSignal; cache?: string }) =>
        new Promise<Response>((resolve, reject) => {
          requests.push({
            url: new URL(url, 'http://localhost'),
            ...options,
            resolve,
            reject,
          })
        })
    )
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('fresh retained file selections', () => {
  it('fetches every retained ID without view filters and uses current tags, names, and sizes in selection order', async () => {
    const pending = render().refresh()
    expect([...requests[0].url.searchParams]).toEqual([
      ['ids', 'older,newer'],
      ['limit', '100'],
    ])
    expect(requests[0].cache).toBe('no-store')
    expect(render().loading).toBe(true)
    complete(0)
    expect(await pending).toEqual([freshFiles[1], freshFiles[0]])
    expect(render().loading).toBe(false)
  })
  it('blocks the editor when any selected file disappeared instead of opening a partial selection', async () => {
    const pending = render().refresh()
    complete(0, [freshFiles[0]])
    await expect(pending).rejects.toThrow('Clear your selection')
    expect(render().loading).toBe(false)
  })
  it('blocks stale metadata after HTTP and network failures', async () => {
    let pending = render().refresh()
    complete(0, undefined, 500)
    await expect(pending).rejects.toThrow('Couldn’t refresh selected files')
    pending = render().refresh()
    requests[1].reject(new Error('offline'))
    await expect(pending).rejects.toThrow('offline')
    expect(render().loading).toBe(false)
  })
  it('rejects duplicate or unrelated records even if the response count matches', async () => {
    const pending = render().refresh()
    complete(0, [freshFiles[0], freshFiles[0]])
    await expect(pending).rejects.toThrow('no longer available')
  })
  it.each(['selection', 'filter'])(
    'discards an obsolete response when the %s changes',
    async (change) => {
      const pending = render().refresh()
      const changed = {
        ...initial,
        ...(change === 'selection'
          ? { files: [oldFiles[0]] }
          : { scope: { folder: 'other' } }),
      }
      expect(render(changed).loading).toBe(false)
      expect(requests[0].signal.aborted).toBe(true)
      complete(0)
      expect(await pending).toBeNull()
    }
  )
  it('lets only the latest request finish and keeps its loading state', async () => {
    const first = render().refresh()
    const second = render().refresh()
    expect(requests[0].signal.aborted).toBe(true)
    complete(0)
    expect(await first).toBeNull()
    expect(render().loading).toBe(true)
    complete(1)
    expect(await second).toEqual([freshFiles[1], freshFiles[0]])
    expect(render().loading).toBe(false)
  })
  it('cancels outstanding hydration on unmount', async () => {
    const pending = render().refresh()
    for (const slot of harness.slots)
      (slot as { cleanup?: () => void })?.cleanup?.()
    expect(requests[0].signal.aborted).toBe(true)
    complete(0)
    expect(await pending).toBeNull()
  })
})
