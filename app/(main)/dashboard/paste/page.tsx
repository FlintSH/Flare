import { redirect } from 'next/navigation'

import { PasteForm } from '@/components/dashboard/paste-form'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function PastePage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  if (
    !hasPermission(session.user, 'pastes.create') ||
    !hasPermission(session.user, 'files.upload')
  )
    redirect('/dashboard/profile')

  return (
    <div className="container space-y-7">
      <PageHeader
        eyebrow="Your files"
        title="Create a paste"
        description="Share text or code, with syntax highlighting from the file extension."
      />
      <div className={pagePanelClassName}>
        <PasteForm />
      </div>
    </div>
  )
}
