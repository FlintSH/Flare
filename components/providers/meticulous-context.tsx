'use client'

import { useEffect } from 'react'

import { useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'

export function MeticulousContext({
  flags,
}: {
  flags: Record<string, boolean>
}) {
  const { data: session, status } = useSession()
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    for (const [name, value] of Object.entries(flags)) {
      window.Meticulous?.context.recordFeatureFlag(name, value)
    }
  }, [flags])

  useEffect(() => {
    if (session?.user) {
      window.Meticulous?.context.recordUserId(session.user.id)
      window.Meticulous?.context.recordUserEmail(session.user.email)
      window.Meticulous?.context.recordCustomContext(
        'userRoles',
        session.user.roles.map((role) => role.name).join(', ')
      )
    }
    window.Meticulous?.context.recordCustomContext('authStatus', status)
  }, [session, status])

  useEffect(() => {
    if (resolvedTheme) {
      window.Meticulous?.context.recordCustomContext('theme', resolvedTheme)
    }
  }, [resolvedTheme])

  return null
}
