import { pagePanelClassName } from '@/components/layout/page-header'
import { LinksManager } from '@/components/links/links-manager'

import { requireDashboardPage } from '../page-access'

export default async function LinksPage() {
  await requireDashboardPage('/dashboard/urls')

  return (
    <section aria-labelledby="links-heading" className={pagePanelClassName}>
      <LinksManager />
    </section>
  )
}
