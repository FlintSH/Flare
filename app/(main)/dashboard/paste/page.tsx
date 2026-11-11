import { PasteForm } from '@/components/dashboard/paste-form'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'

import { requireDashboardPage } from '../page-access'

export default async function PastePage() {
  await requireDashboardPage('/dashboard/paste')

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Your files"
        title="Create a paste"
        description="Share text or code, with syntax highlighting from the file extension."
      />
      <div className={`${pagePanelClassName} max-w-4xl`}>
        <PasteForm />
      </div>
    </div>
  )
}
