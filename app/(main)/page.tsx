import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth/next'

import { authOptions } from '@/lib/auth'
import { checkSetupCompletion } from '@/lib/middleware/auth-checker'

export default async function HomePage() {
  const setupComplete = await checkSetupCompletion()

  if (!setupComplete) {
    redirect('/setup')
  }

  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  redirect('/dashboard')
}
