'use client'

import { type ComponentProps, useRef } from 'react'

import Link from 'next/link'

import { useDraftLeave } from '@/components/providers/draft-leave-provider'

import { leavesDraftPage } from '@/lib/navigation/draft-leave'

/** Keep Next's href/as/ref, modifiers, scroll, replace and transition behavior. */
export function GuardedLink({
  onClickCapture,
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const destination = useRef<string | null>(null)
  const { confirmLeave } = useDraftLeave()
  return (
    <Link
      {...props}
      onClickCapture={(event) => {
        onClickCapture?.(event)
        // The anchor supplies the actual resolved href, including URL objects,
        // base paths and `as`, without rebuilding Next's navigation ourselves.
        destination.current = event.currentTarget.href
      }}
      onNavigate={(event) => {
        let prevented = false
        onNavigate?.({
          ...event,
          preventDefault() {
            prevented = true
            event.preventDefault()
          },
        })
        if (
          !prevented &&
          destination.current &&
          leavesDraftPage(window.location.href, destination.current) &&
          !confirmLeave()
        )
          event.preventDefault()
      }}
    />
  )
}
