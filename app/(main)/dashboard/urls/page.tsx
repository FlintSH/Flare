import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { URLsClient } from '@/components/dashboard/urls-client'

import { authOptions } from '@/lib/auth'

export default async function URLsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  return <URLsClient />
}
