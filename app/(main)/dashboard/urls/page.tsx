import { URLsClient } from '@/components/dashboard/urls-client'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'

import { requireDashboardPage } from '../page-access'

export default async function URLsPage() {
  await requireDashboardPage('/dashboard/urls')

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
