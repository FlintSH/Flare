import { useSyncExternalStore } from 'react'

const unchanging = () => () => {}

/**
 * False while the server renders a page and while the browser hydrates it,
 * true afterwards. Text only the browser can write, such as a date in the
 * reader's time zone, waits for it, so the server's markup always matches.
 */
export function useHydrated() {
  return useSyncExternalStore(
    unchanging,
    () => true,
    () => false
  )
}
