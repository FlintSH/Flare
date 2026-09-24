import { beforeEach, describe, expect, it, vi } from 'vitest'

import { savedViewFiltersSchema } from '@/lib/saved-views/schema'

import { useFileFilters } from '@/hooks/use-file-filters'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
  query: '',
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/files',
  useRouter: () => ({ push: harness.push }),
  useSearchParams: () => new URLSearchParams(harness.query),
}))

// Dependency-aware effects model route restoration separately from user writes.
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots))
      harness.slots[index] = typeof initial === 'function' ? initial() : initial
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
      | { callback: unknown; dependencies: unknown[] }
      | undefined
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
  useEffect: (effect: () => void, dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as unknown[] | undefined
    if (
      previous &&
      dependencies.every((value, i) => Object.is(value, previous[i]))
    )
      return
    harness.effects.push(() => {
      harness.slots[index] = dependencies
      effect()
    })
  },
}))

function render() {
  let result!: ReturnType<typeof useFileFilters>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useFileFilters()
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result
}

beforeEach(() => {
  harness.slots = []
  harness.query = ''
  harness.push.mockReset()
})

describe('saved view library restoration', () => {
  it('replaces every filter in one navigation, clears a previous folder, and preserves page size', () => {
    harness.query = new URLSearchParams({
      folder: 'old-folder',
      tag: 'old-tag',
      search: 'invoice',
      types: 'application/pdf',
      visibility: 'private',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31T23:59:59.999Z',
      sortBy: 'oldest',
      groupBy: 'year',
      page: '4',
      limit: '48',
    }).toString()
    const saved = savedViewFiltersSchema.parse({
      types: ['image/png'],
      groupBy: 'month',
    })
    render().restoreFilters(saved)
    expect(render().filters).toEqual({ ...saved, page: 1, limit: 48 })
    expect(harness.push).toHaveBeenCalledTimes(1)
    const url = new URL(harness.push.mock.calls[0][0], 'https://flare.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      groupBy: 'month',
      types: 'image/png',
      limit: '48',
    })
    expect(render().filterRestoreKey).toBe(1)
  })

  it('restores controls on browser Back and Forward without writing another history entry', () => {
    const before = 'folder=projects&tag=work&page=3&limit=12'
    harness.query = before
    render().restoreFilters(savedViewFiltersSchema.parse({ search: 'holiday' }))
    const after = new URL(
      harness.push.mock.calls[0][0],
      'https://flare.test'
    ).search.slice(1)

    // The app router commits the explicit view navigation.
    harness.query = after
    expect(render().filters).toMatchObject({
      folder: null,
      tag: null,
      search: 'holiday',
      page: 1,
      limit: 12,
    })
    harness.query = before
    const back = render()
    expect(back.filters).toMatchObject({
      folder: 'projects',
      tag: 'work',
      search: '',
      page: 3,
      limit: 12,
    })
    harness.query = after
    const forward = render()
    expect(forward.filters).toMatchObject({
      folder: null,
      tag: null,
      search: 'holiday',
      page: 1,
      limit: 12,
    })
    expect(forward.filterRestoreKey).toBeGreaterThan(back.filterRestoreKey)
    expect(harness.push).toHaveBeenCalledTimes(1)
  })

  it('signals input reset even when the saved search and filters already match', () => {
    const before = render()
    before.restoreFilters(savedViewFiltersSchema.parse({}))
    const after = render()
    expect(after.filters).toEqual(before.filters)
    expect(after.filterRestoreKey).toBe(before.filterRestoreKey + 1)
    expect(harness.push).not.toHaveBeenCalled()
  })
})
