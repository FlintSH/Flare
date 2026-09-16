import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ALIASES,
} from '@/lib/preferences/navigation'

import { usePreferenceSection } from '@/hooks/use-preference-section'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
}))

// Flush state and dependency-aware effects as separate renders, including the
// render that mounts a newly selected panel before its animation frame runs.
vi.mock('react', () => ({
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
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as
      | { dependencies: unknown[]; cleanup?: () => void }
      | undefined
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

let href: string
let listeners: Map<string, (event?: Event) => void>
let frames: Map<number, () => void>
let nextFrame: number
let target: {
  parentElement: Details | null
  closest: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
} | null
let history: {
  state: { __NA: boolean }
  replaceState: ReturnType<typeof vi.fn>
  pushState: ReturnType<typeof vi.fn>
}

class Details {
  open = false
  parentElement: Details | null = null
}

function render(
  initialSection: (typeof SETTINGS_SECTIONS)[number] = 'appearance'
) {
  let result: ReturnType<
    typeof usePreferenceSection<(typeof SETTINGS_SECTIONS)[number]>
  >
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // This harness invokes each render explicitly; React itself is mocked above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = usePreferenceSection(
      SETTINGS_SECTIONS,
      initialSection,
      SETTINGS_SECTION_ALIASES
    )
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result!
}

function flushFrames() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback())
}

beforeEach(() => {
  harness.slots = []
  href = 'https://flare.example/dashboard/settings?section=advanced&recovery=1'
  listeners = new Map()
  frames = new Map()
  nextFrame = 0
  target = {
    parentElement: new Details(),
    closest: vi.fn(() => null),
    scrollIntoView: vi.fn(),
  }
  const updateUrl = (_state: unknown, _title: string, value: string) => {
    href = new URL(value, href).href
  }
  history = {
    state: { __NA: true },
    replaceState: vi.fn(updateUrl),
    pushState: vi.fn(updateUrl),
  }
  vi.stubGlobal('window', {
    location: {
      get href() {
        return href
      },
    },
    history,
    addEventListener: (name: string, callback: (event?: Event) => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  vi.stubGlobal('document', { getElementById: vi.fn(() => target) })
  vi.stubGlobal('HTMLDetailsElement', Details)
})

afterEach(() => vi.unstubAllGlobals())

describe('preference browser navigation', () => {
  it('replaces a legacy entry and reveals only its target disclosure after rendering', () => {
    const unrelatedDisclosure = new Details()
    expect(render()[0]).toBe('appearance')
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/dashboard/settings?section=appearance&recovery=1#advanced-styles'
    )
    expect(history.pushState).not.toHaveBeenCalled()
    expect(target!.scrollIntoView).not.toHaveBeenCalled()
    flushFrames()
    expect(target!.parentElement!.open).toBe(true)
    expect(unrelatedDisclosure.open).toBe(false)
    expect(target!.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('clears stale card anchors when selecting a section and allows Next to sync its URL', () => {
    const [, select] = render()
    select('storage')
    expect(render()[0]).toBe('storage')
    expect(history.pushState).toHaveBeenCalledWith(
      null,
      '',
      '/dashboard/settings?section=storage&recovery=1'
    )
    // Passing Next's __NA state would bypass its patched history URL sync.
    expect(history.pushState.mock.calls[0][0]).not.toBe(history.state)
    expect(frames.size).toBe(0)
  })

  it('restores aliased sections and default sections with back and forward', () => {
    render()
    href = 'https://flare.example/dashboard/settings?section=about'
    listeners.get('popstate')!()
    expect(render()[0]).toBe('general')
    expect(href).toContain('?section=general#instance-information')
    href = 'https://flare.example/dashboard/settings'
    listeners.get('popstate')!()
    expect(render()[0]).toBe('general')
    href = 'https://flare.example/dashboard/settings?section=email'
    listeners.get('popstate')!()
    expect(render()[0]).toBe('email')
  })

  it('updates the visible section while letting a Next link manage history', () => {
    const [, select] = render()
    const originalUrl = href
    history.replaceState.mockClear()

    select('storage', { updateHistory: false })

    expect(render()[0]).toBe('storage')
    expect(href).toBe(originalUrl)
    expect(history.pushState).not.toHaveBeenCalled()
    expect(history.replaceState).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('opens a canonical fragment target when a native link changes the hash', () => {
    href =
      'https://flare.example/dashboard/settings?section=appearance&recovery=1'
    render()
    expect(frames.size).toBe(0)
    href += '#advanced-styles'
    listeners.get('hashchange')!(new Event('hashchange'))
    render()
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/dashboard/settings?section=appearance&recovery=1#advanced-styles'
    )
    flushFrames()
    expect(target!.parentElement!.open).toBe(true)
    expect(target!.scrollIntoView).toHaveBeenCalledOnce()
  })

  it('does not scroll hidden targets or throw on malformed fragments', () => {
    render()
    target!.closest.mockReturnValue({ hidden: true })
    flushFrames()
    expect(target!.scrollIntoView).not.toHaveBeenCalled()
    href =
      'https://flare.example/dashboard/settings?section=appearance#%E0%A4%A'
    listeners.get('hashchange')!()
    expect(() => render()).not.toThrow()
    expect(frames.size).toBe(0)
  })
})
