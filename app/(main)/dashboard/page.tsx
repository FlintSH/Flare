import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'

import { DashboardClient } from './client'

export default async function DashboardPage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  return <DashboardClient />
}
