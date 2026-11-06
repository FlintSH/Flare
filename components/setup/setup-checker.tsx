'use client'

import { useEffect } from 'react'

import { usePathname, useRouter } from 'next/navigation'

import { SETUP_PATH, isSetupPath } from '@/lib/setup/navigation'

import { useSetupStatus } from '@/hooks/use-setup-status'

/**
 * Sends the browser to setup while the instance has no account. It renders
 * nothing, so pages never wait for it. `completed` is the server's answer,
 * left out when the server couldn't read it.
 */
export function SetupChecker({ completed }: { completed?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: setupStatus } = useSetupStatus(completed)
  // Only an answer can say setup is incomplete. A failed check sends nowhere,
  // so the page shows its own state, such as the error page while the
  // database is unreachable.
  const setupIncomplete = setupStatus?.completed === false

  useEffect(() => {
    // A completed instance is never redirected: /setup owns the authenticated
    // continuation after account creation, and leaving it would skip the
    // remaining steps.
    if (setupIncomplete && !isSetupPath(pathname)) router.push(SETUP_PATH)
  }, [setupIncomplete, pathname, router])

  return null
}
