import { PasteForm } from '@/components/dashboard/paste-form'
import {
  PageHeader,
  pagePanelClassName,
  workspaceFormPageClassName,
} from '@/components/layout/page-header'

import { requireDashboardPage } from '../page-access'

export default async function PastePage() {
  await requireDashboardPage('/dashboard/paste')

  return (
    <div className={workspaceFormPageClassName}>
      <PageHeader
        eyebrow="Workspace"
        title="Create a paste"
        description="Share text or code, with syntax highlighting from the file extension."
      />
      <div className={pagePanelClassName}>
        <PasteForm />
      </div>
    </div>
  )
}
