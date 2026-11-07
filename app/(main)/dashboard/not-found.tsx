'use client'

import Link from 'next/link'

import { ArrowLeft } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { dashboardHome } from '@/components/dashboard/navigation'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'

/** Recover inside the authenticated workspace, including its navigation. */
export default function DashboardNotFound() {
  // The layout guards access before streaming. Root AuthProvider supplies
  // the request's session for SSR; Profile is safe while a session refreshes.
  const { data: session } = useSession()
  const home = dashboardHome(session?.user)

  return (
    <section className={`${pagePanelClassName} mx-auto max-w-xl space-y-5`}>
      <PageHeader
        eyebrow="Workspace · 404"
        title="Page not found"
        description="This workspace page doesn’t exist. Check the address or open another page from the navigation."
      />
      <Button asChild className="h-auto min-h-11 max-w-full whitespace-normal">
        <Link href={home}>
          <ArrowLeft aria-hidden="true" />
          {home === '/dashboard' ? 'Go to your files' : 'Go to Profile'}
        </Link>
      </Button>
    </section>
  )
}
