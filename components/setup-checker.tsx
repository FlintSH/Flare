'use client'

import { useEffect } from 'react'

import { usePathname, useRouter } from 'next/navigation'

import {
  useSetupStatus,
  useSetupStatusMutations,
} from '@/hooks/use-setup-status'

interface SetupCheckerProps {
  children: React.ReactNode
}

export function SetupChecker({ children }: SetupCheckerProps) {
  const router = useRouter()
  const pathname = usePathname()

  // Skip setup check for setup pages and API routes
  const shouldCheckSetup =
    !pathname.startsWith('/setup') && !pathname.startsWith('/api/')

  const {
    data: setupStatus,
    isLoading,
    error,
  } = useSetupStatus(shouldCheckSetup)
  const { updateSetupStatus } = useSetupStatusMutations()

  // Listen for setup completion events for immediate cache updates
  useEffect(() => {
    const handleSetupCompleted = (event: CustomEvent) => {
      updateSetupStatus(event.detail.completed)
    }

    const handleSetupIncomplete = (event: CustomEvent) => {
      updateSetupStatus(event.detail.completed)
    }

    window.addEventListener(
      'setup-completed',
      handleSetupCompleted as EventListener
    )
    window.addEventListener(
      'setup-incomplete',
      handleSetupIncomplete as EventListener
    )

    return () => {
      window.removeEventListener(
        'setup-completed',
        handleSetupCompleted as EventListener
      )
      window.removeEventListener(
        'setup-incomplete',
        handleSetupIncomplete as EventListener
      )
    }
  }, [updateSetupStatus])

  useEffect(() => {
    // Don't redirect during loading or if check is disabled
    if (isLoading || !shouldCheckSetup) return

    if (error) {
      console.error('Setup check failed:', error)
      // On error, assume setup is needed
      if (!pathname.startsWith('/setup')) {
        router.push('/setup')
      }
      return
    }

    if (setupStatus) {
      // Redirect to setup if not completed
      if (!setupStatus.completed && !pathname.startsWith('/setup')) {
        router.push('/setup')
        return
      }

      // Redirect away from setup if completed
      if (setupStatus.completed && pathname.startsWith('/setup')) {
        router.push('/dashboard')
        return
      }
    }
  }, [setupStatus, isLoading, error, pathname, router, shouldCheckSetup])

  // Show loading state only for initial load
  if (isLoading && shouldCheckSetup) {
    return null
  }

  // Render children if setup check passed or is not needed
  return <>{children}</>
}
