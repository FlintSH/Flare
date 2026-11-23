import { useCallback, useRef, useTransition } from 'react'

import { useRouter } from 'next/navigation'

/**
 * Reads the account's upload defaults again, for a card about to say what a
 * quick upload will use: another tab may have changed them. At most once
 * every few seconds per card; `reading` until the page has them, so a card
 * never shows a read it didn't wait for.
 */
export function useFreshDefaults() {
  const router = useRouter()
  const [reading, startReading] = useTransition()
  const lastRead = useRef(0)
  const read = useCallback(() => {
    const now = Date.now()
    if (now - lastRead.current < 5000) return
    lastRead.current = now
    startReading(() => router.refresh())
  }, [router])
  return { read, reading }
}
