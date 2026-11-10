import { cache } from 'react'

import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

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

/** Where an account without encryption keys chooses its passphrase. */
const KEY_SETUP_PATH = '/auth/encryption'

/**
 * Key setup comes before the application for an account that has no keys
 * (docs/e2ee-spec.md, section 14.1): its password hash must go. An account
 * without a sign-in address cannot set up keys, so it is let through to add
 * one.
 */
export async function requireAccountKeys(userId: string | undefined) {
  if (!userId) return
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { authPublicKey: true, email: true },
  })
  if (account && !account.authPublicKey && account.email)
    redirect(KEY_SETUP_PATH)
}
