import { redirect } from 'next/navigation'

import { URLsClient } from '@/components/dashboard/urls-client'

import { getPageSession } from '@/lib/auth/page-session'
import { hasPermission } from '@/lib/permissions/catalog'

export default async function URLsPage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  if (!hasPermission(session.user, 'links.read')) redirect('/dashboard/profile')

  return (
    <div className="container space-y-6">
      <header className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-xl sm:p-6">
        <h1 className="text-3xl font-semibold tracking-tight">URL Shortener</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Shorten long URLs and monitor their traffic
        </p>
      </header>
      <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm backdrop-blur-xl sm:p-6">
        <URLsClient />
      </div>
    </div>
  )
}
