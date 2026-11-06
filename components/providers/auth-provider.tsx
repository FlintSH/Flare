'use client'

import { useEffect } from 'react'

import type { Session } from 'next-auth'
import { SessionProvider, getSession } from 'next-auth/react'

/**
 * `session` is the server's answer for the page, so the first paint already
 * knows who is signed in. Without one, the browser asks for it.
 */
export function AuthProvider({
  session,
  children,
}: {
  session?: Session | null
  children: React.ReactNode
}) {
  const fromServer = session !== undefined
  useEffect(() => {
    // Given a session, next-auth skips its first session request, and that
    // request is what tells other tabs to read their session again. Without
    // it, a tab stays on the old account after a sign-in in another tab.
    if (fromServer) void getSession()
  }, [fromServer])
  return <SessionProvider session={session}>{children}</SessionProvider>
}
