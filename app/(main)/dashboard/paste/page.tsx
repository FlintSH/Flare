import { redirect } from 'next/navigation'

import { PasteForm } from '@/components/dashboard/paste-form'

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
    <div className="container space-y-6">
      <header className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-xl sm:p-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Create New Paste
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create text pastes with syntax highlighting
        </p>
      </header>
      <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-xl sm:p-6">
        <PasteForm />
      </div>
    </div>
  )
}
