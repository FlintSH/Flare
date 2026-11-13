'use client'

import { type ComponentType, useSyncExternalStore } from 'react'

import { toast } from '@/hooks/use-toast'

// The request made last, across every on-demand component. One that had to
// wait for its code must not open after something that was asked for later.
let latestRequest = 0

/**
 * A component whose code is fetched when someone first asks for it, so a page
 * doesn't download dialogs most visits never open.
 *
 * `show` runs its callback once the code is here: at once when it already
 * is, otherwise after the fetch, so the dialog mounts complete instead of
 * arriving in pieces. A callback that had to wait runs only if nothing was
 * asked for since and `stillWanted` agrees, because the person may have
 * moved on while the code was on its way. `preload` fetches ahead of the
 * click, from the hover or focus of whatever opens it. Rendered before its
 * code has arrived, the component renders nothing.
 */
export function onDemand<Props extends object>(
  load: () => Promise<ComponentType<Props>>
) {
  let Loaded: ComponentType<Props> | undefined
  let request: Promise<void> | undefined
  const listeners = new Set<() => void>()

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const fetchCode = () =>
    (request ??= load().then(
      (component) => {
        Loaded = component
        for (const listener of listeners) listener()
      },
      (error: unknown) => {
        // Forgotten, so the next attempt asks the server again.
        request = undefined
        throw error
      }
    ))

  function OnDemand(props: Props) {
    const Component = useSyncExternalStore(
      subscribe,
      () => Loaded,
      () => undefined
    )
    return Component ? <Component {...props} /> : null
  }

  return Object.assign(OnDemand, {
    preload() {
      // A failed attempt is reported when someone asks to see it.
      if (!Loaded) fetchCode().catch(() => {})
    },
    show(open: () => void, stillWanted: () => boolean = () => true) {
      const request = ++latestRequest
      if (Loaded) return open()
      const current = () => request === latestRequest && stillWanted()
      fetchCode().then(
        () => {
          if (current()) open()
        },
        () => {
          // Nobody is waiting for what they have since left behind.
          if (current())
            toast({
              title: 'Couldn’t open that',
              description: 'Check your connection and try again.',
              variant: 'destructive',
            })
        }
      )
    },
  })
}
