import { Suspense } from 'react'

import { redirect } from 'next/navigation'

import { FileRequestsWorkspace } from '@/components/file-requests/requests-workspace'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function FileRequestsPage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  if (
    !hasPermission(session.user, 'fileRequests.manage') ||
    !hasPermission(session.user, 'files.upload')
  )
    redirect('/dashboard/profile')

  return (
    <div className="container space-y-7">
      <Suspense>
        <FileRequestsWorkspace />
      </Suspense>
    </div>
  )
}
