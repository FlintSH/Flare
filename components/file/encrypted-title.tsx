'use client'

import { useSyncExternalStore } from 'react'

/**
 * The name of the encrypted file a share page shows. The server renders the
 * page without it; the browser sets it after it decrypted the name.
 */
let title: string | null = null
const watchers = new Set<() => void>()

export function setEncryptedFileTitle(next: string | null) {
  if (title === next) return
  title = next
  for (const watch of watchers) watch()
}

const subscribe = (watch: () => void) => {
  watchers.add(watch)
  return () => {
    watchers.delete(watch)
  }
}

export function EncryptedFileTitle({ fallback }: { fallback: string }) {
  const name = useSyncExternalStore(
    subscribe,
    () => title,
    () => null
  )
  return (
    <span data-encrypted-title={name ? 'open' : 'sealed'}>
      {name ?? fallback}
    </span>
  )
}
