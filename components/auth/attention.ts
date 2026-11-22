'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a page must stay in front of the person before a click on it counts. */
export const ATTENTION_MS = 500

/** What the watch reads of a page: its window's events and its document's state. */
export type AttentionPage = {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>
  document: Pick<
    Document,
    'visibilityState' | 'hasFocus' | 'addEventListener' | 'removeEventListener'
  >
}

/**
 * Reports whether the page has the person's attention: `true` once it has
 * been visible and focused for `wait` milliseconds without a break, `false`
 * the moment it is hidden or loses focus. Coming back starts the wait again.
 * Nothing is reported until the first `true`. Returns what stops the watch.
 *
 * A click can be aimed at one page and land on another: someone is led to
 * double-click, the first click swaps this page in, and the second falls on
 * whatever is under the pointer. A button that waits for this cannot be hit
 * that way, however the page came to the front.
 */
export function watchAttention(
  onChange: (attended: boolean) => void,
  wait = ATTENTION_MS,
  page: AttentionPage = { window, document }
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let attended = false
  // Kept from the events rather than asked for each time: while a blur is
  // being handled, browsers differ on what the document says of its focus.
  let focused = page.document.hasFocus()

  function report(next: boolean) {
    if (next === attended) return
    attended = next
    onChange(next)
  }
  function restart() {
    clearTimeout(timer)
    report(false)
    if (focused && page.document.visibilityState === 'visible')
      timer = setTimeout(() => report(true), wait)
  }
  const onFocus = () => {
    focused = true
    restart()
  }
  const onBlur = () => {
    focused = false
    restart()
  }
  // A page restored from the back and forward cache is in front again.
  const onShow = () => {
    focused = page.document.hasFocus()
    restart()
  }

  page.window.addEventListener('focus', onFocus)
  page.window.addEventListener('blur', onBlur)
  page.window.addEventListener('pageshow', onShow)
  page.document.addEventListener('visibilitychange', restart)
  restart()
  return () => {
    clearTimeout(timer)
    page.window.removeEventListener('focus', onFocus)
    page.window.removeEventListener('blur', onBlur)
    page.window.removeEventListener('pageshow', onShow)
    page.document.removeEventListener('visibilitychange', restart)
  }
}

/**
 * Whether the page has had the person's attention for a moment; see
 * `watchAttention`. It is false on the server and at first render, so what
 * it guards is off in the page as it arrives.
 *
 * `attended` is for drawing and follows one render behind. `holds()` answers
 * for this instant: the event that takes the attention away is known to it
 * at once, before anything is drawn again, so a click on that event's heels
 * is still refused. Ask it in the handler of whatever is guarded.
 */
export function useAttention(wait = ATTENTION_MS) {
  const [attended, setAttended] = useState(false)
  const live = useRef(false)
  useEffect(() => {
    const stop = watchAttention((next) => {
      live.current = next
      setAttended(next)
    }, wait)
    return () => {
      stop()
      live.current = false
    }
  }, [wait])
  const holds = useCallback(() => live.current, [])
  return { attended, holds }
}

/**
 * Calls `onRestore` when the browser shows the page again out of its back
 * and forward cache. Such a page comes back exactly as it was left, so
 * whatever it was in the middle of, such as waiting on the navigation that
 * took the person away, has to be put right by hand. Returns what stops it.
 */
export function watchRestore(
  onRestore: () => void,
  target: AttentionPage['window'] = window
): () => void {
  const onShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) onRestore()
  }
  target.addEventListener('pageshow', onShow)
  return () => target.removeEventListener('pageshow', onShow)
}
