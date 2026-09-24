import type { ComponentProps, ReactElement } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchInput } from '@/components/dashboard/file-grid/search-input'
import { Input } from '@/components/ui/input'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  memo: (component: unknown) => component,
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (value: unknown) => {
        if (!Object.is(harness.slots[index], value)) harness.dirty = true
        harness.slots[index] = value
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
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

type Props = ComponentProps<typeof SearchInput>
type FieldProps = ComponentProps<typeof Input>

function render(props: Props): FieldProps {
  let tree!: ReactElement<{ children: ReactElement[] }>
  do {
    harness.cursor = 0
    harness.dirty = false
    harness.effects = []
    tree = SearchInput(props) as typeof tree
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return tree.props.children.find((child) => child.type === Input)!
    .props as FieldProps
}

beforeEach(() => {
  harness.slots = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('search input during library restoration', () => {
  it('cancels pending search text when a view restores the same committed search', () => {
    const onSearch = vi.fn()
    const props = { onSearch, initialValue: '', resetKey: 0 }
    render(props).onChange?.({ target: { value: 'unfinished' } } as never)
    expect(render(props).value).toBe('unfinished')

    expect(render({ ...props, resetKey: 1 }).value).toBe('')
    vi.advanceTimersByTime(500)
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('flushes the typed search on blur before the Save view action can capture filters', () => {
    const onSearch = vi.fn()
    const props = { onSearch, initialValue: '' }
    render(props).onChange?.({ target: { value: 'receipts' } } as never)
    render(props).onBlur?.({} as never)
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('receipts')
    vi.advanceTimersByTime(500)
    expect(onSearch).toHaveBeenCalledTimes(1)
  })

  it('does not reset pagination by submitting an unchanged search on blur', () => {
    const onSearch = vi.fn()
    render({ onSearch, initialValue: 'receipts' }).onBlur?.({} as never)
    expect(onSearch).not.toHaveBeenCalled()
  })
})
