import { describe, expect, it } from 'vitest'

import { scrollFadeRef } from '@/lib/utils/scroll-fade'

/** Just enough of an element for the ref callback, in the node test env. */
function list(scrollTop: number, clientHeight: number, scrollHeight: number) {
  const attributes = new Set<string>()
  const listeners = new Set<() => void>()
  const element = {
    scrollTop,
    clientHeight,
    scrollHeight,
    toggleAttribute: (name: string, force: boolean) =>
      force ? attributes.add(name) : attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
    scroll(to: number) {
      element.scrollTop = to
      for (const listener of listeners) listener()
    },
    listeners,
  }
  return element
}

const attach = (element: ReturnType<typeof list>) =>
  scrollFadeRef(element as unknown as HTMLElement)

describe('scrollFadeRef', () => {
  it('marks only the edges that have more to scroll', () => {
    const element = list(0, 100, 300)
    attach(element)
    expect(element.hasAttribute('data-scroll-above')).toBe(false)
    expect(element.hasAttribute('data-scroll-below')).toBe(true)

    element.scroll(100)
    expect(element.hasAttribute('data-scroll-above')).toBe(true)
    expect(element.hasAttribute('data-scroll-below')).toBe(true)

    element.scroll(200)
    expect(element.hasAttribute('data-scroll-above')).toBe(true)
    expect(element.hasAttribute('data-scroll-below')).toBe(false)
  })

  it('leaves a list that fits without fades and cleans up', () => {
    const element = list(0, 100, 100)
    const cleanup = attach(element)
    expect(element.hasAttribute('data-scroll-above')).toBe(false)
    expect(element.hasAttribute('data-scroll-below')).toBe(false)
    expect(element.listeners.size).toBe(1)
    cleanup?.()
    expect(element.listeners.size).toBe(0)
    expect(scrollFadeRef(null)).toBeUndefined()
  })
})
