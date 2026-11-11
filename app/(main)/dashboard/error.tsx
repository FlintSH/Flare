'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'

import { pagePanelClassName } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'

/** Keep workspace navigation available when one dashboard page fails. */
export default function DashboardError({
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <section className={`${pagePanelClassName} mx-auto max-w-xl text-center`}>
      <AlertCircle
        aria-hidden="true"
        className="mx-auto mb-4 h-8 w-8 text-destructive"
      />
      <h1 className="text-2xl font-semibold tracking-tight">
        Couldn’t load this page
      </h1>
      <p className="mb-6 mt-2 text-sm leading-relaxed text-muted-foreground">
        Try again, or use the navigation to open another part of your workspace.
      </p>
      <Button onClick={retry}>
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </section>
  )
}
