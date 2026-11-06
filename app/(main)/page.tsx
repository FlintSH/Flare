import { redirect } from 'next/navigation'

import { getRequestSession } from '@/lib/auth/page-session'
import { SETUP_PATH } from '@/lib/setup/navigation'
import { isSetupComplete } from '@/lib/setup/status'

export default async function HomePage() {
  const setupComplete = await isSetupComplete()

  if (!setupComplete) {
    redirect(SETUP_PATH)
  }

  const session = await getRequestSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  redirect('/dashboard')
}
