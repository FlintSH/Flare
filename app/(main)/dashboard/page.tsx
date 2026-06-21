import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth/next'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'

import { DashboardClient } from './client'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  const config = await getConfig()
  const organizationEnabled = config.settings.general.organization.enabled

  return <DashboardClient organizationEnabled={organizationEnabled} />
}
