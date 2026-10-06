import type { FileFilterOptions } from '@/types/components/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  libraryPositionKey,
  readLibraryPosition,
  withLibraryPosition,
} from '@/lib/files/library-position'

import { readFileFilters } from '@/hooks/use-file-filters'
import { useFileLibraryPosition } from '@/hooks/use-file-library-position'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
}))
vi.mock('react', () => ({
  useState: vi.fn(),
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
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

const filters = readFileFilters(new URLSearchParams(), 24)
const key = libraryPositionKey(filters)
const nextState = {
  __NA: true,
  __PRIVATE_NEXTJS_INTERNALS_TREE: ['dashboard'],
  preserved: 'value',
}
let location: { pathname: string; search: string }
let history: {
  state: unknown
  replaceState: ReturnType<typeof vi.fn>
  pushState: ReturnType<typeof vi.fn>
}
let listeners: Map<string, Set<(event?: unknown) => void>>
let onRestore: () => void
class LinkElement {
  closest() {
    return this
  }
}
function dispatch(type: string, event?: unknown) {
  listeners.get(type)?.forEach((listener) => listener(event))
}
function render(selected: FileFilterOptions = filters, query = '') {
  harness.cursor = 0
  harness.effects = []
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = useFileLibraryPosition(selected, '/dashboard', query, () =>
    onRestore()
  )
  harness.effects.forEach((effect) => effect())
  return result
}
function unmount() {
  for (const slot of harness.slots) {
    const effect = slot as { cleanup?: () => void } | undefined
    effect?.cleanup?.()
  }
}

beforeEach(() => {
  harness.slots = []
  listeners = new Map()
  location = { pathname: '/dashboard', search: '' }
  history = {
    state: nextState,
    replaceState: vi.fn((state: unknown) => {
      history.state = state
    }),
    pushState: vi.fn(),
  }
  onRestore = vi.fn()
  vi.useFakeTimers()
  vi.stubGlobal('Element', LinkElement)
  vi.stubGlobal('window', {
    location,
    history,
    addEventListener: (type: string, listener: (event?: unknown) => void) => {
      const group = listeners.get(type) ?? new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener: (type: string, listener: (event?: unknown) => void) =>
      listeners.get(type)?.delete(listener),
  })
})
afterEach(() => {
  unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('file library history positions', () => {
  it('canonicalizes parsed filters and rejects unrelated or malformed history positions', () => {
    const first = readFileFilters(
      new URLSearchParams(
        'types=image/png,image/jpeg&visibility=private,public&page=1&limit=24'
      ),
      24
    )
    const equivalent = readFileFilters(
      new URLSearchParams(
        'visibility=public,private&types=image/jpeg,image/png'
      ),
      24
    )
    expect(libraryPositionKey(first)).toBe(libraryPositionKey(equivalent))
    expect(
      readLibraryPosition(withLibraryPosition(nextState, key, 11999), key, 0)
    ).toBe(11999)
    for (const state of [
      null,
      {},
      withLibraryPosition(nextState, 'different', 99),
      withLibraryPosition(nextState, key, -1),
      withLibraryPosition(nextState, key, 1.5),
    ])
      expect(readLibraryPosition(state, key, 48)).toBe(48)
  })

  it('restores the current entry immediately on mount and preserves legacy page fallback', () => {
    history.state = withLibraryPosition(nextState, key, 11999)
    expect(render().position.current).toBe(11999)
    expect(history.replaceState).not.toHaveBeenCalled()
    location.search = '?page=3'
    expect(render({ ...filters, page: 3 }, 'page=3').position.current).toBe(48)
  })

  it('bounds scroll writes to twice a second and preserves Next router state without changing URL or adding entries', () => {
    const hook = render()
    hook.record(10)
    vi.advanceTimersByTime(200)
    hook.record(20)
    vi.advanceTimersByTime(299)
    expect(history.replaceState).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(history.replaceState).toHaveBeenCalledTimes(1)
    expect(history.replaceState.mock.calls[0]).toEqual([
      withLibraryPosition(nextState, key, 20),
      '',
    ])
    expect(history.pushState).not.toHaveBeenCalled()
    expect(location).toEqual({ pathname: '/dashboard', search: '' })
    hook.record(20)
    vi.advanceTimersByTime(500)
    expect(history.replaceState).toHaveBeenCalledTimes(1)
  })

  it('flushes the latest position before a file link navigates and never overwrites its destination entry on cleanup', () => {
    const hook = render()
    hook.record(11996)
    dispatch('click', { target: new LinkElement() })
    expect(readLibraryPosition(history.state, key, 0)).toBe(11996)
    location.pathname = '/alex/holiday.png'
    history.state = { ...nextState, sharePage: true }
    hook.record(0) // A queued final render during route navigation.
    unmount()
    expect(history.replaceState).toHaveBeenCalledTimes(1)
    expect(history.state).toEqual({ ...nextState, sharePage: true })
    expect([...listeners.values()].every((group) => group.size === 0)).toBe(
      true
    )
  })

  it('does not corrupt an old filter entry while router.push is still committing its URL', () => {
    const selected = { ...filters, search: 'invoice' }
    const hook = render(selected) // Local controls changed; URL is still old.
    hook.record(48)
    vi.advanceTimersByTime(500)
    expect(history.replaceState).not.toHaveBeenCalled()
    location.search = '?search=invoice'
    const committed = render(selected, 'search=invoice')
    committed.record(96)
    vi.advanceTimersByTime(500)
    expect(
      readLibraryPosition(history.state, libraryPositionKey(selected), 0)
    ).toBe(96)
  })

  it('restores same-filter popstate and cancels a pending write from the entry being left', () => {
    const hook = render()
    hook.record(999)
    history.state = withLibraryPosition(nextState, key, 5000)
    dispatch('popstate')
    expect(hook.position.current).toBe(5000)
    expect(onRestore).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(readLibraryPosition(history.state, key, 0)).toBe(5000)
    expect(history.replaceState).not.toHaveBeenCalled()
  })

  it('restores another filter entry after popstate and ignores foreign paths', () => {
    const hook = render()
    hook.record(48)
    const selected = { ...filters, search: 'invoice' }
    location.search = '?search=invoice'
    history.state = withLibraryPosition(
      nextState,
      libraryPositionKey(selected),
      200
    )
    dispatch('popstate')
    expect(onRestore).not.toHaveBeenCalled()
    expect(render(selected, 'search=invoice').position.current).toBe(200)
    location.pathname = '/other'
    dispatch('popstate')
    expect(onRestore).not.toHaveBeenCalled()
    expect(history.replaceState).not.toHaveBeenCalled()
  })

  it('flushes on pagehide and treats restricted history as a recoverable browser limitation', () => {
    const hook = render()
    hook.record(600)
    dispatch('pagehide')
    expect(readLibraryPosition(history.state, key, 0)).toBe(600)
    history.replaceState.mockImplementation(() => {
      throw new Error('History quota')
    })
    hook.record(900)
    expect(() => vi.advanceTimersByTime(500)).not.toThrow()
    expect(hook.position.current).toBe(900)
  })
})
