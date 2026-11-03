'use client'

import { useEffect } from 'react'

/**
 * Marks the page with how it was last used (`data-input="keyboard"` or
 * `"pointer"` on <html>). Some widgets move focus as the pointer moves, so
 * `:focus-visible` can't tell a keyboard user from a mouse user there; the
 * stylesheet uses this to show the focus ring on keyboard use only (select
 * options, app/globals.css).
 */
export function InputModality() {
  useEffect(() => {
    const root = document.documentElement
    const keyboard = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.altKey && !event.ctrlKey)
        root.dataset.input = 'keyboard'
    }
    const pointer = () => {
      root.dataset.input = 'pointer'
    }
    window.addEventListener('keydown', keyboard, true)
    window.addEventListener('pointerdown', pointer, true)
    return () => {
      window.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('pointerdown', pointer, true)
    }
  }, [])
  return null
}
