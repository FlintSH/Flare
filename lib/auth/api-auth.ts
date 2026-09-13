import { NextResponse } from 'next/server'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'

export type AuthenticatedUser = {
  id: string
  storageUsed: number
  urlId: string
  vanityId: string | null
  role: string
  randomizeFileUrls: boolean
}

export async function getAuthenticatedUser(
  req: Request
): Promise<AuthenticatedUser | null> {
  const session = await getAccessSession()
  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        storageUsed: true,
        urlId: true,
        vanityId: true,
        role: true,
        randomizeFileUrls: true,
        email: true,
        emailVerified: true,
        emailVerifiedFor: true,
        emailVerificationSource: true,
        emailExempt: true,
        createdAt: true,
      },
    })
    return user && !requiresEmailVerification(user, await getEmailConfig())
      ? user
      : null
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const user = await prisma.user.findUnique({
      where: { uploadToken: token },
      select: {
        id: true,
        storageUsed: true,
        urlId: true,
        vanityId: true,
        role: true,
        randomizeFileUrls: true,
        email: true,
        emailVerified: true,
        emailVerifiedFor: true,
        emailVerificationSource: true,
        emailExempt: true,
        createdAt: true,
      },
    })
    return user && !requiresEmailVerification(user, await getEmailConfig())
      ? user
      : null
  }

  return null
}

export async function requireAuth(req: Request) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
    }
  }
  return { user, response: null }
}

export async function requireAdmin() {
  const session = await getAccessSession()

  if (!session?.user || session.user.role !== 'ADMIN') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
    }
  }

  return { user: session.user, response: null }
}
