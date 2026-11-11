import { pagePanelClassName } from '@/components/layout/page-header'
import { Skeleton } from '@/components/ui/skeleton'

/** A neutral workspace transition for settings, tools and collections alike. */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-6">
      <header
        aria-hidden="true"
        className="space-y-3 border-b border-border/60 pb-5"
      >
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-2/3 max-w-md" />
      </header>
      <div aria-hidden="true" className={`${pagePanelClassName} space-y-5`}>
        <Skeleton className="h-5 w-1/3 max-w-xs" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-10 w-1/2" />
      </div>
    </div>
  )
}
