'use client'

import { useEffect } from 'react'

import { usePathname, useRouter } from 'next/navigation'

import { SETUP_PATH, isSetupPath } from '@/lib/setup/navigation'

import { useSetupStatus } from '@/hooks/use-setup-status'

interface SetupCheckerProps {
  children: React.ReactNode
}

export function SetupChecker({ children }: SetupCheckerProps) {
  const router = useRouter()
  const pathname = usePathname()

  const shouldCheckSetup = !pathname.startsWith('/api/')

  const { data: setupStatus, isLoading } = useSetupStatus(shouldCheckSetup)
  // Only a successful answer can say setup is incomplete. A failed check
  // sends nowhere, so the page shows its own state, such as the error page
  // while the database is unreachable.
  const setupIncomplete = shouldCheckSetup && setupStatus?.completed === false

  useEffect(() => {
    // A completed instance is never redirected: /setup owns the authenticated
    // continuation after account creation, and leaving it would skip the
    // remaining steps.
    if (setupIncomplete && !isSetupPath(pathname)) router.push(SETUP_PATH)
  }, [setupIncomplete, pathname, router])

  if (isLoading && shouldCheckSetup) {
    return null
  }

  return <>{children}</>
}
