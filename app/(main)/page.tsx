import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth/next'

import { authOptions } from '@/lib/auth'
import { SETUP_PATH } from '@/lib/setup/navigation'
import { isSetupComplete } from '@/lib/setup/status'

export default async function HomePage() {
  const setupComplete = await isSetupComplete()

  if (!setupComplete) {
    redirect(SETUP_PATH)
  }

  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  redirect('/dashboard')
}
