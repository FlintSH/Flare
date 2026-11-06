import { cache } from 'react'

import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'

/**
 * The browser session of the request being rendered, read once however many
 * layouts and pages ask for it.
 */
export const getRequestSession = cache(() => getServerSession(authOptions))

export async function getPageSession() {
  const session = await getRequestSession()
  if (session?.user?.emailAccessRequired) redirect('/auth/verify-email')
  return session
}
