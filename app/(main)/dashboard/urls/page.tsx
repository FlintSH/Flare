import { redirect } from 'next/navigation'

import { WorkspacePage } from '@/components/dashboard/page-shell'
import { URLsClient } from '@/components/dashboard/urls-client'

import { getPageSession } from '@/lib/auth/page-session'

export default async function URLsPage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  return (
    <WorkspacePage
      title="Short links"
      description="Turn long addresses into simple links. Keep every destination and its activity in one place."
    >
      <URLsClient />
    </WorkspacePage>
  )
}
