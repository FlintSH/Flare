'use client'

import type { MouseEvent, ReactNode } from 'react'

/**
 * A way back to a shared folder that has keys. Its address has the folder
 * key after `#`, which no server-made link can carry (docs/e2ee-spec.md,
 * section 9.4.3). When the visitor came from that folder page, going back
 * in the browser's history restores the address with its key. Otherwise the
 * link opens the folder without a key, and the page says what is missing.
 */
export function HistoryBackLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    let from: URL | null = null
    try {
      from = document.referrer ? new URL(document.referrer) : null
    } catch {
      from = null
    }
    if (
      from?.origin === window.location.origin &&
      from.pathname.startsWith('/s/folders/') &&
      window.history.length > 1
    ) {
      event.preventDefault()
      window.history.back()
    }
  }
  return (
    <a href={href} onClick={back} className={className}>
      {children}
    </a>
  )
}
