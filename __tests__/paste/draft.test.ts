// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { clearDraft, readDraft, writeDraft } from '@/components/paste/draft'

/** Whether the browser would ask before the tab goes away. */
const asksBeforeLeaving = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

afterEach(() => {
  writeDraft('alex', { content: '', name: '' })
})

describe('the paste draft', () => {
  it('is kept for its account only', () => {
    writeDraft('alex', { content: 'notes', name: 'a.md' })
    expect(readDraft('alex')).toEqual({ content: 'notes', name: 'a.md' })
    expect(readDraft('sam')).toEqual({ content: '', name: '' })
  })

  it('asks before the tab goes away while it holds text, on any page', () => {
    expect(asksBeforeLeaving()).toBe(false)
    writeDraft('alex', { content: 'secret log', name: '' })
    expect(asksBeforeLeaving()).toBe(true)
    writeDraft('alex', { content: '   ', name: 'only-a-name.txt' })
    expect(asksBeforeLeaving()).toBe(false)
  })

  it('is cleared by the paste it was saved as, and stops asking', () => {
    const saved = { content: 'first', name: '' }
    writeDraft('alex', saved)
    clearDraft(saved)
    expect(readDraft('alex')).toEqual({ content: '', name: '' })
    expect(asksBeforeLeaving()).toBe(false)
  })

  it('keeps newer text written while an older paste was being created', () => {
    const saved = { content: 'first', name: '' }
    writeDraft('alex', saved)
    const newer = { content: 'first, then more', name: '' }
    writeDraft('alex', newer)
    clearDraft(saved)
    expect(readDraft('alex')).toBe(newer)
    expect(asksBeforeLeaving()).toBe(true)
  })
})
