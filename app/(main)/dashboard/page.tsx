import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

import { DashboardClient } from './client'

export default async function DashboardPage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  if (!hasPermission(session.user, 'files.read')) redirect('/dashboard/profile')

  return <DashboardClient />
}
