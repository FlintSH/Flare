import { redirect } from 'next/navigation'

import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { PasteForm } from '@/components/paste/paste-form'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { savedUploadSettings } from '@/lib/uploads/saved-settings'

import { requireDashboardPage } from '../page-access'

export default async function PastePage() {
  const session = await requireDashboardPage('/dashboard/paste')
  const saved = await savedUploadSettings(session.user.id)
  if (!saved) redirect(SIGN_IN_PATH)

  return (
    <section aria-labelledby="paste-heading" className={pagePanelClassName}>
      <PageHeader
        className="mb-5 border-0 pb-0"
        actionsBesideTitle
        title={<span id="paste-heading">Paste</span>}
      />
      <PasteForm saved={saved} />
    </section>
  )
}
