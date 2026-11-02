import { redirect } from 'next/navigation'

import { URLsClient } from '@/components/dashboard/urls-client'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function URLsPage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  if (!hasPermission(session.user, 'links.read')) redirect('/dashboard/profile')

  return (
    <div className="container space-y-7">
      <PageHeader
        eyebrow="Sharing"
        title="Short links"
        description="Shorten long URLs and see how often they're opened."
      />
      <div className={pagePanelClassName}>
        <URLsClient />
      </div>
    </div>
  )
}
