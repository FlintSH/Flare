import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'

export async function getPageSession() {
  const session = await getServerSession(authOptions)
  if (session?.user?.emailAccessRequired) redirect('/auth/verify-email')
  return session
}
