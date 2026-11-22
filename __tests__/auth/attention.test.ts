import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ATTENTION_MS,
  type AttentionPage,
  watchAttention,
  watchRestore,
} from '@/components/auth/attention'

/** A window and document that only know what the watch asks of them. */
function fakePage({ visible = true, focused = true } = {}) {
  const state = { visible, focused }
  const window = new EventTarget()
  const document = Object.defineProperties(new EventTarget(), {
    visibilityState: { get: () => (state.visible ? 'visible' : 'hidden') },
    hasFocus: { value: () => state.focused },
  })
  return {
    page: { window, document } as unknown as AttentionPage,
    blur() {
      state.focused = false
      window.dispatchEvent(new Event('blur'))
    },
    focus() {
      state.focused = true
      window.dispatchEvent(new Event('focus'))
    },
    hide() {
      state.visible = false
      document.dispatchEvent(new Event('visibilitychange'))
    },
    show() {
      state.visible = true
      document.dispatchEvent(new Event('visibilitychange'))
    },
    /** As when the page comes back from the back and forward cache. */
    restore(focusedNow = true) {
      state.focused = focusedNow
      window.dispatchEvent(new Event('pageshow'))
    },
  }
}

/** Watches a fake page; `attended()` is what a button guarded by it would see. */
function watch(options?: Parameters<typeof fakePage>[0], wait?: number) {
  const fake = fakePage(options)
  const reports: boolean[] = []
  const stop = watchAttention(
    (attended) => reports.push(attended),
    wait,
    fake.page
  )
  return { ...fake, reports, stop, attended: () => reports.at(-1) ?? false }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('waiting for a page to have the person in front of it', () => {
  it('waits half a second', () => {
    expect(ATTENTION_MS).toBe(500)
  })

  it('is off at first, and on once the page has been in front for the wait', () => {
    const page = watch()
    expect(page.attended()).toBe(false)
    // Nothing is said until there is something to turn on.
    expect(page.reports).toEqual([])
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.reports).toEqual([true])
    // It stays on while nothing changes.
    vi.advanceTimersByTime(60_000)
    expect(page.reports).toEqual([true])
  })

  it('goes off the moment the page loses focus, and waits again on return', () => {
    const page = watch()
    vi.advanceTimersByTime(ATTENTION_MS)
    page.blur()
    expect(page.attended()).toBe(false)
    // However long it stays away.
    vi.advanceTimersByTime(60_000)
    expect(page.attended()).toBe(false)
    page.focus()
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.reports).toEqual([true, false, true])
  })

  it('goes off the moment the page is hidden, and waits again once shown', () => {
    const page = watch()
    vi.advanceTimersByTime(ATTENTION_MS)
    page.hide()
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(page.attended()).toBe(false)
    page.show()
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.reports).toEqual([true, false, true])
  })

  it('starts the wait over when the page is left during it', () => {
    const page = watch()
    vi.advanceTimersByTime(ATTENTION_MS - 100)
    page.blur()
    page.focus()
    // The time before the break does not count.
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.reports).toEqual([true])

    const other = watch()
    vi.advanceTimersByTime(ATTENTION_MS - 100)
    other.hide()
    other.show()
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(other.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(other.reports).toEqual([true])
  })

  it('starts the wait over on a focus or a return that says the page was away', () => {
    const page = watch()
    vi.advanceTimersByTime(ATTENTION_MS)
    // Focus again without a blur between: the window was swapped in.
    page.focus()
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(ATTENTION_MS)
    expect(page.attended()).toBe(true)
    page.restore()
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.reports).toEqual([true, false, true, false, true])
  })

  it('needs both: a page that is in view but not focused stays off, and the reverse', () => {
    const unfocused = watch({ focused: false })
    vi.advanceTimersByTime(60_000)
    expect(unfocused.reports).toEqual([])
    unfocused.focus()
    vi.advanceTimersByTime(ATTENTION_MS)
    expect(unfocused.reports).toEqual([true])

    const hidden = watch({ visible: false })
    vi.advanceTimersByTime(60_000)
    expect(hidden.reports).toEqual([])
    // Focus alone is not enough while it cannot be seen.
    hidden.focus()
    vi.advanceTimersByTime(60_000)
    expect(hidden.reports).toEqual([])
    hidden.show()
    vi.advanceTimersByTime(ATTENTION_MS)
    expect(hidden.reports).toEqual([true])

    // Restored from the cache into a window that is not in front.
    const restored = watch()
    vi.advanceTimersByTime(ATTENTION_MS)
    restored.restore(false)
    vi.advanceTimersByTime(60_000)
    expect(restored.reports).toEqual([true, false])
  })

  it('takes the wait it is given', () => {
    const page = watch(undefined, 50)
    vi.advanceTimersByTime(49)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.attended()).toBe(true)
  })

  it('says nothing more once stopped', () => {
    const page = watch()
    page.stop()
    vi.advanceTimersByTime(60_000)
    page.blur()
    page.focus()
    page.hide()
    page.show()
    page.restore()
    vi.advanceTimersByTime(60_000)
    expect(page.reports).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    // Stopped while on, it leaves the last word as it was.
    const on = watch()
    vi.advanceTimersByTime(ATTENTION_MS)
    on.stop()
    on.blur()
    expect(on.reports).toEqual([true])
  })
})

describe('a page brought back from the back and forward cache', () => {
  const pageshow = (persisted: boolean) =>
    Object.assign(new Event('pageshow'), { persisted })

  it('is told apart from a page shown for the first time', () => {
    const target = new EventTarget()
    const restored = vi.fn()
    const stop = watchRestore(restored, target as unknown as Window)
    // Every page gets a pageshow once it has loaded; that one is not a return.
    target.dispatchEvent(pageshow(false))
    target.dispatchEvent(new Event('pageshow'))
    expect(restored).not.toHaveBeenCalled()
    target.dispatchEvent(pageshow(true))
    expect(restored).toHaveBeenCalledTimes(1)
    // Each return counts.
    target.dispatchEvent(pageshow(true))
    expect(restored).toHaveBeenCalledTimes(2)
    stop()
    target.dispatchEvent(pageshow(true))
    expect(restored).toHaveBeenCalledTimes(2)
  })

  it('also starts the wait for attention again', () => {
    const page = watch()
    const restored = vi.fn()
    watchRestore(restored, page.page.window)
    vi.advanceTimersByTime(ATTENTION_MS)
    expect(page.attended()).toBe(true)
    // The fake window is an EventTarget; the watch is only shown part of it.
    ;(page.page.window as unknown as EventTarget).dispatchEvent(pageshow(true))
    expect(restored).toHaveBeenCalledTimes(1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(ATTENTION_MS - 1)
    expect(page.attended()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(page.attended()).toBe(true)
  })
})
